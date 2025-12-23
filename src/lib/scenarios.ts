import type { Scenario } from './telemetry';
import { trace } from '@opentelemetry/api';

function sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
}

function deterministicPercent(runId: string): number {
    let h = 0;
    for (let i = 0; i < runId.length; i++) h = (h * 31 + runId.charCodeAt(i)) >>> 0;
    return h % 100;
}

export async function runScenario(args: { run_id: string; scenario: Scenario }) {
    const tracer = trace.getTracer('gcg');

    const costByScenario: Record<Scenario, number> = {
        normal: 0.02,
        latency: 0.05,
        error: 0.01,
        security: 0.5,
    };

    return tracer.startActiveSpan('gcg.scenario.execute', async span => {
        span.setAttribute('gcg.run_id', args.run_id);
        span.setAttribute('gcg.scenario', args.scenario);

        try {
            await tracer.startActiveSpan('gcg.policy.evaluate', async pSpan => {
                const triggered = args.scenario === 'security';
                const action = triggered ? 'BLOCK' : 'ALLOW';
                pSpan.setAttribute('gcg.security.triggered', triggered);
                pSpan.setAttribute('gcg.policy.action', action);
                pSpan.end();
            });

            if (args.scenario === 'latency') {
                await tracer.startActiveSpan('gcg.synthetic.sleep', async sSpan => {
                    await sleep(4500);
                    sSpan.end();
                });

                return {
                    outcome: 'ok' as const,
                    status_code: 200,
                    security_flag: false,
                    tool_calls: 0,
                    cost_usd: costByScenario.latency,
                    response_text: 'OK (latency injected)',
                };
            }

            if (args.scenario === 'error') {
                const p = deterministicPercent(args.run_id);
                const shouldError = p < 60; // 60% error rate, deterministic per run_id

                if (shouldError) {
                    return {
                        outcome: 'error' as const,
                        status_code: 500,
                        security_flag: false,
                        tool_calls: 0,
                        cost_usd: costByScenario.error,
                        response_text: 'Simulated 500 (demo)',
                    };
                }

                return {
                    outcome: 'ok' as const,
                    status_code: 200,
                    security_flag: false,
                    tool_calls: 0,
                    cost_usd: costByScenario.error,
                    response_text: 'OK (non-error sample)',
                };
            }

            if (args.scenario === 'security') {
                return {
                    outcome: 'blocked' as const,
                    status_code: 403,
                    security_flag: true,
                    tool_calls: 30,
                    cost_usd: costByScenario.security,
                    response_text: 'Blocked by gateway policy (demo)',
                };
            }

            // normal
            return {
                outcome: 'ok' as const,
                status_code: 200,
                security_flag: false,
                tool_calls: 0,
                cost_usd: costByScenario.normal,
                response_text: 'OK (stubbed)',
            };
        } finally {
            span.end();
        }
    });
}
