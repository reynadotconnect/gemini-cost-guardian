/* eslint-disable @typescript-eslint/no-explicit-any */
import 'dotenv/config';
type Scenario = 'normal' | 'latency' | 'error' | 'security';

type RunResponse = {
    run_id: string;
    scenario: Scenario;
    outcome: 'ok' | 'error' | 'blocked';
    status_code: number;
    duration_ms: number;
    cost_usd: number;
    tool_calls: number;
    security_flag: boolean;
    trace_id: string;
};

const DEFAULT_BASE_URL = 'http://localhost:3000';

// Tunables (set env vars for Cloud Run demo runs)
const REQUEST_TIMEOUT_MS = Number(process.env.GCG_REQUEST_TIMEOUT_MS ?? 30_000);
const MAX_INFLIGHT = Number(process.env.GCG_MAX_INFLIGHT ?? 12);
const DEFAULT_RPS = Number(process.env.GCG_RPS ?? 2);

// Sustain durations should match your monitor window reality.
// If any monitor uses last_5m, set this to 180_000+.
const SUSTAIN_MS = Number(process.env.GCG_SUSTAIN_MS ?? 120_000);

const COST_TARGET = Number(process.env.GCG_COST_TARGET_USD ?? 0.2);
const TOOLCALL_TARGET = Number(process.env.GCG_TOOLCALL_TARGET ?? 40);
const LATENCY_TARGET_MS = Number(process.env.GCG_LATENCY_TARGET_MS ?? 3_000);

function sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
}

function nowIso() {
    return new Date().toISOString();
}

function pct(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const a = [...arr].sort((x, y) => x - y);
    const idx = Math.min(a.length - 1, Math.max(0, Math.floor((p / 100) * a.length)));
    return a[idx];
}

function makeSessionId(): string {
    // Node 18+ has global crypto; fallback if needed
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return (globalThis as any).crypto?.randomUUID?.() ?? `sess_${Date.now()}_${Math.random()}`;
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        const text = await res.text();
        let json: any = null;
        try {
            json = text ? JSON.parse(text) : {};
        } catch {
            json = { _non_json_body: text };
        }
        return { res, json };
    } finally {
        clearTimeout(t);
    }
}

function isRetriableStatus(status: number) {
    return status === 429 || status === 503 || status === 504;
}

async function postRun(args: {
    baseUrl: string;
    scenario: Scenario;
    sessionId: string;
    phaseName: string;
    seq: number;
}): Promise<RunResponse> {
    const { baseUrl, scenario, sessionId, phaseName, seq } = args;

    const url = `${baseUrl}/api/run`;
    const body = {
        scenario,
        // Optional fields: safe even if backend ignores them
        traffic_session_id: sessionId,
        traffic_phase: phaseName,
        traffic_seq: seq,
    };

    let attempt = 0;
    while (true) {
        attempt += 1;

        const { res, json } = await fetchJsonWithTimeout(
            url,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-gcg-traffic-session': sessionId,
                    'x-gcg-traffic-phase': phaseName,
                    'x-gcg-traffic-scenario': scenario,
                    'x-gcg-traffic-seq': String(seq),
                },
                body: JSON.stringify(body),
            },
            REQUEST_TIMEOUT_MS
        );

        const merged = { ...(json ?? {}) } as RunResponse;

        // Ensure status_code exists even if handler doesn't include it
        (merged as any).status_code = (merged as any).status_code ?? res.status;

        if (!isRetriableStatus(res.status) || attempt >= 5) {
            return merged;
        }

        // capped backoff
        const backoff = Math.min(2000, 250 * attempt * attempt);
        await sleep(backoff);
    }
}

async function runSustainedPhase(args: {
    baseUrl: string;
    sessionId: string;
    phaseName: string;
    scenario: Scenario;
    durationMs: number;
    rps: number;
}) {
    const { baseUrl, sessionId, phaseName, scenario, durationMs, rps } = args;

    const start = Date.now();
    const intervalMs = Math.max(1, Math.floor(1000 / rps));

    let sent = 0;
    let ok = 0;
    let err = 0;
    let blocked = 0;

    const durations: number[] = [];
    const costs: number[] = [];
    const toolCalls: number[] = [];

    const inflight = new Set<Promise<void>>();

    console.log(
        `\n=== PHASE: ${phaseName} | scenario=${scenario} | target_rps=${rps} | duration=${Math.round(
            durationMs / 1000
        )}s | session=${sessionId} | start=${nowIso()} ===`
    );

    let nextAt = Date.now();

    async function launchOne(seq: number) {
        const tickStart = Date.now();
        try {
            const r = await postRun({ baseUrl, scenario, sessionId, phaseName, seq });

            if (r.outcome === 'ok') ok += 1;
            else if (r.outcome === 'error') err += 1;
            else blocked += 1;

            durations.push(Number(r.duration_ms ?? 0));
            costs.push(Number(r.cost_usd ?? 0));
            toolCalls.push(Number(r.tool_calls ?? 0));

            console.log(
                JSON.stringify({
                    ts: nowIso(),
                    session: sessionId,
                    phase: phaseName,
                    scenario: r.scenario,
                    run_id: r.run_id,
                    trace_id: r.trace_id,
                    outcome: r.outcome,
                    status_code: r.status_code,
                    duration_ms: r.duration_ms,
                    cost_usd: r.cost_usd,
                    tool_calls: r.tool_calls,
                    security_flag: r.security_flag,
                })
            );
        } catch (e: any) {
            err += 1;
            console.log(
                JSON.stringify({
                    ts: nowIso(),
                    session: sessionId,
                    phase: phaseName,
                    scenario,
                    error: 'request_failed',
                    message: String(e?.message ?? e),
                })
            );
        } finally {
            const elapsed = Date.now() - tickStart;
            const wait = Math.max(0, intervalMs - elapsed);
            if (wait > 0) await sleep(wait);
        }
    }

    while (Date.now() - start < durationMs) {
        if (Date.now() < nextAt) {
            await sleep(Math.min(10, nextAt - Date.now()));
            continue;
        }
        nextAt += intervalMs;

        if (inflight.size >= MAX_INFLIGHT) {
            // wait for any inflight to finish
            await Promise.race(inflight);
            continue;
        }

        sent += 1;
        const p = launchOne(sent).then(() => {
            // no-op
        });
        inflight.add(p);
        p.finally(() => inflight.delete(p));
    }

    // drain
    await Promise.allSettled([...inflight]);

    const actualSeconds = Math.max(1, (Date.now() - start) / 1000);
    const actualRps = sent / actualSeconds;

    console.log(
        `=== END PHASE: ${phaseName} | sent=${sent} ok=${ok} error=${err} blocked=${blocked} | ` +
            `actual_rps=${actualRps.toFixed(2)} | ` +
            `dur_p50=${pct(durations, 50)}ms dur_p95=${pct(durations, 95)}ms | ` +
            `max_cost=$${Math.max(0, ...costs).toFixed(4)} | max_tool_calls=${Math.max(
                0,
                ...toolCalls
            )} | end=${nowIso()} ===`
    );

    return { sent, ok, err, blocked, durations, costs, toolCalls };
}

async function runUntilConditionThenSustain(args: {
    baseUrl: string;
    sessionId: string;
    phaseName: string;
    scenario: Scenario;
    rps: number;
    maxProbeMs: number;
    condition: (r: RunResponse) => boolean;
    conditionName: string;
}) {
    const { baseUrl, sessionId, phaseName, scenario, rps, maxProbeMs, condition, conditionName } =
        args;

    console.log(
        `\n--- PROBE: ${phaseName} | waiting for condition="${conditionName}" (max ${Math.round(
            maxProbeMs / 1000
        )}s) ---`
    );

    const probeStart = Date.now();
    let seq = 0;

    while (Date.now() - probeStart < maxProbeMs) {
        seq += 1;
        const r = await postRun({ baseUrl, scenario, sessionId, phaseName, seq });

        console.log(
            JSON.stringify({
                ts: nowIso(),
                session: sessionId,
                phase: phaseName,
                probe: true,
                scenario: r.scenario,
                run_id: r.run_id,
                trace_id: r.trace_id,
                outcome: r.outcome,
                status_code: r.status_code,
                duration_ms: r.duration_ms,
                cost_usd: r.cost_usd,
                tool_calls: r.tool_calls,
                security_flag: r.security_flag,
            })
        );

        if (condition(r)) {
            console.log(`--- CONDITION MET: ${conditionName} | trace_id=${r.trace_id} ---`);
            // sustain for monitor evaluation window
            await runSustainedPhase({
                baseUrl,
                sessionId,
                phaseName: `${phaseName}_sustain`,
                scenario,
                durationMs: SUSTAIN_MS,
                rps,
            });
            return;
        }

        await sleep(Math.max(1, Math.floor(1000 / rps)));
    }

    console.log(
        `--- CONDITION NOT MET within ${Math.round(maxProbeMs / 1000)}s: ${conditionName}. ` +
            `This means the backend scenario="${scenario}" did not produce the expected signal. ---`
    );
}

async function main() {
    const baseUrl = (process.env.GCG_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
    const sessionId = process.env.GCG_TRAFFIC_SESSION_ID ?? makeSessionId();

    console.log(`Gemini Cost Guardian Traffic Generator`);
    console.log(`Target: ${baseUrl}`);
    console.log(`Session: ${sessionId}`);
    console.log(
        `\nDemo intent: produce tagged signals that deterministically satisfy thresholds, then sustain for window.` +
            `\nTune with env: GCG_SUSTAIN_MS, GCG_MAX_INFLIGHT, GCG_RPS, GCG_*_TARGET\n`
    );

    // Warmup baseline
    await runSustainedPhase({
        baseUrl,
        sessionId,
        phaseName: 'warmup',
        scenario: 'normal',
        durationMs: 30_000,
        rps: 1,
    });

    // Cost spike / tool abuse / security are usually driven by the "security" scenario in your app.
    // Probe until we actually see the high-cost/high-tool/security flag response, then sustain.
    await runUntilConditionThenSustain({
        baseUrl,
        sessionId,
        phaseName: 'abuse',
        scenario: 'security',
        rps: DEFAULT_RPS,
        maxProbeMs: 90_000,
        conditionName: `security_flag=true AND tool_calls>=${TOOLCALL_TARGET} AND cost_usd>=${COST_TARGET}`,
        condition: r =>
            Boolean(r.security_flag) &&
            Number(r.tool_calls ?? 0) >= TOOLCALL_TARGET &&
            Number(r.cost_usd ?? 0) >= COST_TARGET,
    });

    // Latency probe then sustain
    await runUntilConditionThenSustain({
        baseUrl,
        sessionId,
        phaseName: 'latency',
        scenario: 'latency',
        rps: DEFAULT_RPS,
        maxProbeMs: 90_000,
        conditionName: `duration_ms>=${LATENCY_TARGET_MS}`,
        condition: r => Number(r.duration_ms ?? 0) >= LATENCY_TARGET_MS,
    });

    // Error probe then sustain
    await runUntilConditionThenSustain({
        baseUrl,
        sessionId,
        phaseName: 'error',
        scenario: 'error',
        rps: DEFAULT_RPS,
        maxProbeMs: 60_000,
        conditionName: `status_code>=500 OR outcome=error`,
        condition: r => Number(r.status_code ?? 0) >= 500 || r.outcome === 'error',
    });

    console.log(
        `\nDONE.\n` +
            `Datadog drill-down: filter by session tag/header value: ${sessionId}\n` +
            `If monitors still don’t fire: your monitor query/window doesn’t match the tags or you need a longer GCG_SUSTAIN_MS.`
    );
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
