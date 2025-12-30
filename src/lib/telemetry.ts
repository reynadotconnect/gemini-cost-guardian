import { context, metrics, trace, SpanStatusCode, type Context } from '@opentelemetry/api';

export type Scenario = 'normal' | 'latency' | 'error' | 'security';

const tracer = trace.getTracer('gcg');
const meter = metrics.getMeter('gcg');

const hits = meter.createCounter('gcg.run.hits');
const errors = meter.createCounter('gcg.run.errors');
const securityEvents = meter.createCounter('gcg.security.events');
const toolCalls = meter.createCounter('gcg.tool.calls');
const costUsd = meter.createCounter('gcg.cost.usd');
const durationMs = meter.createHistogram('gcg.run.duration_ms', { unit: 'ms' });

const alertLatencyMs = meter.createHistogram('gcg.alert.latency_ms', { unit: 'ms' });
const alertErrorStatus = meter.createHistogram('gcg.alert.error_status', { unit: '{code}' });
const alertSecurity = meter.createCounter('gcg.alert.security');
const alertToolCalls = meter.createHistogram('gcg.alert.tool_calls', { unit: '{calls}' });
const alertCostUsd = meter.createHistogram('gcg.alert.cost_usd', { unit: 'usd' });

const alertLatencyBreaches = meter.createCounter('gcg.alert.latency_breaches');
const alertErrorBreaches = meter.createCounter('gcg.alert.error_breaches');
const alertToolBreaches = meter.createCounter('gcg.alert.tool_breaches');
const alertCostBreaches = meter.createCounter('gcg.alert.cost_breaches');

const promptTokens = meter.createCounter('gcg.tokens.prompt');
const outputTokens = meter.createCounter('gcg.tokens.output');
const totalTokens = meter.createCounter('gcg.tokens.total');

function parseAttrs(v?: string) {
    const out: Record<string, string> = {};
    if (!v) return out;
    for (const raw of v.split(',')) {
        const s = raw.trim();
        if (!s) continue;
        const idx = s.includes('=') ? s.indexOf('=') : s.indexOf(':');
        if (idx === -1) continue;
        out[s.slice(0, idx).trim()] = s.slice(idx + 1).trim();
    }
    return out;
}

export type RunTelemetry = {
    run_id: string;
    scenario: Scenario;
    outcome: 'ok' | 'error' | 'blocked';
    status_code: number;
    duration_ms: number;
    cost_usd: number;
    tool_calls: number;
    security_flag: boolean;
    prompt_tokens: number;
    output_tokens: number;
    total_tokens: number;
};

export async function withRunSpan<T>(
    input: {
        run_id: string;
        scenario: Scenario;
        traffic_session: string | undefined;
        traffic_phase: string | undefined;
        traffic_seq: string | undefined;
    },
    fn: (
        runCtx: Context
    ) => Promise<{ result: T; telemetry: Omit<RunTelemetry, 'run_id' | 'scenario'> }>
): Promise<{ result: T; telemetry: RunTelemetry; trace_id: string }> {
    const parentCtx = context.active();
    const span = tracer.startSpan('gcg.run', undefined, parentCtx);
    span.setAttribute('gcg.run_id', input.run_id);
    span.setAttribute('gcg.scenario', input.scenario);

    const runCtx = trace.setSpan(parentCtx, span);

    try {
        const { result, telemetry } = await fn(runCtx);
        const full: RunTelemetry = {
            run_id: input.run_id,
            scenario: input.scenario,
            ...telemetry,
        };

        span.setAttribute('gcg.outcome', full.outcome);
        span.setAttribute('gcg.security_flag', full.security_flag);
        span.setAttribute('gcg.tool_calls', full.tool_calls);
        span.setAttribute('gcg.cost_usd', full.cost_usd);
        span.setAttribute('gcg.status_code', full.status_code);
        span.setAttribute('gcg.duration_ms', full.duration_ms);

        if (full.outcome === 'error') span.setStatus({ code: SpanStatusCode.ERROR });

        const attrs = parseAttrs(process.env.OTEL_RESOURCE_ATTRIBUTES);
        const tags = {
            scenario: full.scenario,
            outcome: full.outcome,
            status_code: String(full.status_code),
            service: process.env.OTEL_SERVICE_NAME || 'gemini-cost-guardian',
            env: attrs['deployment.environment'] || process.env.NODE_ENV || 'dev',
            traffic_session: input.traffic_session || undefined,
            traffic_phase: input.traffic_phase || undefined,
            traffic_seq: input.traffic_seq || undefined,
        };

        hits.add(1, tags);
        durationMs.record(full.duration_ms, tags);
        if (full.outcome === 'error') errors.add(1, tags);
        if (full.security_flag) securityEvents.add(1, tags);
        toolCalls.add(full.tool_calls, tags);
        costUsd.add(full.cost_usd, tags);
        promptTokens.add(full.prompt_tokens, tags);
        outputTokens.add(full.output_tokens, tags);
        totalTokens.add(full.total_tokens, tags);

        const ctx = span.spanContext();
        const trace_id = ctx.traceId;

        const alertTags = {
            ...tags,
            run_id: full.run_id,
            trace_id,
        };

        const latencyThresholdMs = Number(process.env.GCG_LATENCY_THRESHOLD_MS || '3000');
        if (Number.isFinite(latencyThresholdMs) && full.duration_ms > latencyThresholdMs) {
            alertLatencyMs.record(full.duration_ms, alertTags);
            alertLatencyBreaches.add(1, alertTags);
        }

        if (full.outcome === 'error' || full.status_code >= 500) {
            alertErrorStatus.record(full.status_code, alertTags);
            alertErrorBreaches.add(1, alertTags);
        }

        if (full.security_flag) {
            alertSecurity.add(1, alertTags);
        }

        const toolThreshold = Number(process.env.GCG_TOOL_CALL_THRESHOLD || '40');
        if (Number.isFinite(toolThreshold) && full.tool_calls > toolThreshold) {
            alertToolCalls.record(full.tool_calls, alertTags);
            alertToolBreaches.add(1, alertTags);
        }

        const costThreshold = Number(process.env.GCG_COST_THRESHOLD_USD || '0.2');
        if (Number.isFinite(costThreshold) && full.cost_usd > costThreshold) {
            alertCostUsd.record(full.cost_usd, alertTags);
            alertCostBreaches.add(1, alertTags);
        }

        return { result, telemetry: full, trace_id };
    } finally {
        span.end();
    }
}
