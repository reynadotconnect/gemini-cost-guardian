import {
    context,
    metrics,
    trace,
    SpanStatusCode,
    type Context,
    type Span,
} from '@opentelemetry/api';

export type Scenario = 'normal' | 'latency' | 'error' | 'security';

const tracer = trace.getTracer('gcg');
const meter = metrics.getMeter('gcg');

const hits = meter.createCounter('gcg.run.hits');
const errors = meter.createCounter('gcg.run.errors');
const securityEvents = meter.createCounter('gcg.security.events');
const toolCalls = meter.createCounter('gcg.tool.calls');
const costUsd = meter.createCounter('gcg.cost.usd');
const durationMs = meter.createHistogram('gcg.run.duration_ms', { unit: 'ms' });

export type RunTelemetry = {
    run_id: string;
    scenario: Scenario;
    outcome: 'ok' | 'error' | 'blocked';
    status_code: number;
    duration_ms: number;
    cost_usd: number;
    tool_calls: number;
    security_flag: boolean;
};

export async function withRunSpan<T>(
    input: { run_id: string; scenario: Scenario },
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

        const tags = {
            scenario: full.scenario,
            outcome: full.outcome,
            status_code: String(full.status_code),
        };

        hits.add(1, tags);
        durationMs.record(full.duration_ms, tags);
        if (full.outcome === 'error') errors.add(1, tags);
        if (full.security_flag) securityEvents.add(1, tags);
        toolCalls.add(full.tool_calls, tags);
        costUsd.add(full.cost_usd, tags);

        const ctx = span.spanContext();
        return { result, telemetry: full, trace_id: ctx.traceId };
    } finally {
        span.end();
    }
}
