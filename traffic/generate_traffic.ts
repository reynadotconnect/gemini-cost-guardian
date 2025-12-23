/* eslint-disable no-console */

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

function sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
}

function nowIso() {
    return new Date().toISOString();
}

function msSince(start: number) {
    return Date.now() - start;
}

async function postRun(baseUrl: string, scenario: Scenario): Promise<RunResponse> {
    const res = await fetch(`${baseUrl}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario }),
    });

    const json = (await res.json()) as RunResponse;

    // Ensure we always have the HTTP status even if handler returns it in body
    json.status_code = json.status_code ?? res.status;

    return json;
}

async function runPhase(args: {
    baseUrl: string;
    phaseName: string;
    scenario: Scenario;
    durationMs: number;
    rps: number;
}) {
    const { baseUrl, phaseName, scenario, durationMs, rps } = args;

    const start = Date.now();
    const intervalMs = Math.max(1, Math.floor(1000 / rps));

    let sent = 0;
    let ok = 0;
    let err = 0;
    let blocked = 0;

    console.log(
        `\n=== PHASE: ${phaseName} | scenario=${scenario} | rps=${rps} | duration=${Math.round(
            durationMs / 1000
        )}s | start=${nowIso()} ===`
    );

    while (msSince(start) < durationMs) {
        const tickStart = Date.now();
        sent += 1;

        try {
            const r = await postRun(baseUrl, scenario);

            if (r.outcome === 'ok') ok += 1;
            else if (r.outcome === 'error') err += 1;
            else blocked += 1;

            // One-line JSON output for correlation / copy-paste
            console.log(
                JSON.stringify({
                    ts: nowIso(),
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
                    phase: phaseName,
                    scenario,
                    error: 'request_failed',
                    message: String(e?.message ?? e),
                })
            );
        }

        const elapsed = Date.now() - tickStart;
        const wait = Math.max(0, intervalMs - elapsed);
        if (wait > 0) await sleep(wait);
    }

    console.log(
        `=== END PHASE: ${phaseName} | sent=${sent} ok=${ok} error=${err} blocked=${blocked} | end=${nowIso()} ===`
    );
}

async function main() {
    const baseUrl = (process.env.GCG_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');

    console.log(`Gemini Cost Guardian Traffic Generator`);
    console.log(`Target: ${baseUrl}`);
    console.log(
        `Expected monitors to fire (demo):\n` +
            `- [GCG] Latency Regression (slow runs > 3s)\n` +
            `- [GCG] Error Rate Spike (>20%)\n` +
            `- [GCG] Security Event Detected\n` +
            `- [GCG] Excessive Tool Calls (>40 in 1m)\n` +
            `- [GCG] Cost Spike (>$2 in 2m)\n`
    );

    // Phase plan (tuned for live demo)
    // - Warmup: establish baseline metrics/traces
    // - Latency: force slow runs so latency monitor trips
    // - Error: force enough 500s so error-rate trips
    // - Security: force security/tool/cost monitors
    await runPhase({
        baseUrl,
        phaseName: 'warmup',
        scenario: 'normal',
        durationMs: 30_000,
        rps: 1,
    });
    await runPhase({
        baseUrl,
        phaseName: 'latency',
        scenario: 'latency',
        durationMs: 90_000,
        rps: 2,
    });
    await runPhase({ baseUrl, phaseName: 'error', scenario: 'error', durationMs: 90_000, rps: 2 });
    await runPhase({
        baseUrl,
        phaseName: 'security',
        scenario: 'security',
        durationMs: 60_000,
        rps: 2,
    });

    console.log(
        `\nDONE. If a monitor didn't fire, increase the phase duration by +60s for that phase.`
    );
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
