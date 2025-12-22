import { metrics, trace, SpanStatusCode } from '@opentelemetry/api';

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
  duration_ms: number;
  cost_usd: number;
  tool_calls: number;
  security_flag: boolean;
};

export async function withRunSpan<T>(
  input: { run_id: string; scenario: Scenario },
  fn: () => Promise<{ result: T; telemetry: Omit<RunTelemetry, 'run_id' | 'scenario'> }>
): Promise<{ result: T; telemetry: RunTelemetry; trace_id: string }> {
  const span = tracer.startSpan('gcg.run', {
    attributes: { 'gcg.run_id': input.run_id, 'gcg.scenario': input.scenario },
  });

  const start = Date.now();
  try {
    const { result, telemetry } = await fn();
    span.setAttribute('gcg.outcome', telemetry.outcome);
    span.setAttribute('gcg.security_flag', telemetry.security_flag);
    span.setAttribute('gcg.tool_calls', telemetry.tool_calls);
    span.setAttribute('gcg.cost_usd', telemetry.cost_usd);

    if (telemetry.outcome === 'error') span.setStatus({ code: SpanStatusCode.ERROR });

    const full: RunTelemetry = { run_id: input.run_id, scenario: input.scenario, ...telemetry };

    // metrics: all monitors will read these
    const tags = { scenario: full.scenario, outcome: full.outcome };
    hits.add(1, tags);
    durationMs.record(full.duration_ms, tags);
    if (full.outcome === 'error') errors.add(1, tags);
    if (full.security_flag) securityEvents.add(1, tags);
    toolCalls.add(full.tool_calls, tags);
    costUsd.add(full.cost_usd, tags);

    return { result, telemetry: full, trace_id: span.spanContext().traceId };
  } finally {
    span.end();
    // duration is computed in handler (so deterministic). kept here for symmetry.
    void start;
  }
}
