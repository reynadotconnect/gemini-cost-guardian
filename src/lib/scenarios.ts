import type { Scenario } from './telemetry';
import { context, trace, SpanStatusCode, type Context } from '@opentelemetry/api';
import { generateWithGemini, type GeminiResult } from './gemini';

function sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
}

function deterministicPercent(runId: string): number {
    let h = 0;
    for (let i = 0; i < runId.length; i++) h = (h * 31 + runId.charCodeAt(i)) >>> 0;
    return h % 100;
}

export async function runScenario(
    args: { run_id: string; scenario: Scenario },
    parentCtx?: Context
) {
    const tracer = trace.getTracer('gcg');
    const ctx0 = parentCtx ?? context.active();

    const scenarioSpan = tracer.startSpan('gcg.scenario.execute', undefined, ctx0);
    scenarioSpan.setAttribute('gcg.run_id', args.run_id);
    scenarioSpan.setAttribute('gcg.scenario', args.scenario);

    const scenarioCtx = trace.setSpan(ctx0, scenarioSpan);

    try {
        const costByScenario: Record<Scenario, number> = {
            normal: 0.02,
            latency: 0.05,
            error: 0.01,
            security: 0.5,
        };

        function usdFromTokens(usage: { prompt_tokens: number; output_tokens: number }): number {
            const inRate = Number(process.env.GCG_USD_PER_1M_INPUT_TOKENS ?? '0.30');
            const outRate = Number(process.env.GCG_USD_PER_1M_OUTPUT_TOKENS ?? '2.50');
            return (usage.prompt_tokens * inRate + usage.output_tokens * outRate) / 1_000_000;
        }

        if (args.scenario === 'normal') {
            const g = await generateWithGemini(
                scenarioCtx,
                'Respond with any random confirmation message: "Operation complete", "Success", "Confirmed", or "Task executed".',
                {
                    maxOutputTokens: 64,
                }
            );

            // Validate response and provide fallback if empty
            const responseText = g.text?.trim();
            if (!responseText) {
                throw new Error(`Empty resp.text; typeof=${typeof g.text}`);
            }

            scenarioSpan.setAttribute('gcg.vertex.sample', responseText.slice(0, 32));
            scenarioSpan.setAttribute('gcg.response.valid', !!g.text?.trim());

            return {
                outcome: 'ok' as const,
                status_code: 200,
                security_flag: false,
                tool_calls: 1,
                cost_usd: usdFromTokens(g.usage),
                prompt_tokens: g.usage.prompt_tokens,
                output_tokens: g.usage.output_tokens,
                total_tokens: g.usage.total_tokens,
                response_text: responseText,
            };
        }

        const policySpan = tracer.startSpan('gcg.policy.evaluate', undefined, scenarioCtx);
        try {
            const triggered = args.scenario === 'security';
            policySpan.setAttribute('gcg.security.triggered', triggered);
            policySpan.setAttribute('gcg.policy.action', triggered ? 'BLOCK' : 'ALLOW');
        } finally {
            policySpan.end();
        }

        if (args.scenario === 'latency') {
            // real Gemini call + optional synthetic sleep for deterministic monitor triggering
            const bigPrompt = 'Write 300 words about observabiliity. ' + 'Context: '.repeat(2000);
            const g = await generateWithGemini(scenarioCtx, bigPrompt, { maxOutputTokens: 512 });

            const sleepSpan = tracer.startSpan('gcg.synthetic.sleep', undefined, scenarioCtx);
            try {
                const thresholdMs = Number(process.env.GCG_LATENCY_THRESHOLD_MS || '3000');
                const injectMs = Number(
                    process.env.GCG_LATENCY_INJECT_MS ||
                        String((Number.isFinite(thresholdMs) ? thresholdMs : 3000) + 750)
                );
                await sleep(Math.max(0, injectMs));
            } finally {
                sleepSpan.end();
            }
            return {
                outcome: 'ok' as const,
                status_code: 200,
                security_flag: false,
                tool_calls: 1,
                cost_usd: usdFromTokens(g.usage),
                prompt_tokens: g.usage.prompt_tokens,
                output_tokens: g.usage.output_tokens,
                total_tokens: g.usage.total_tokens,
                response_text: 'OK (gemini + latency injected)',
            };
        }

        if (args.scenario === 'error') {
            const p = deterministicPercent(args.run_id);
            const retries = p < 60 ? 6 : 1;
            const agg = { prompt_tokens: 0, output_tokens: 0, total_tokens: 0 };

            let g: GeminiResult = {
                text: '',
                usage: {
                    prompt_tokens: 0,
                    output_tokens: 0,
                    total_tokens: 0,
                },
            };
            for (let i = 0; i < retries; i++) {
                g = await generateWithGemini(scenarioCtx, `Return "ok". Attempt=${i}`, {
                    maxOutputTokens: 32,
                });

                agg.prompt_tokens += g.usage.prompt_tokens;
                agg.output_tokens += g.usage.output_tokens;
                agg.total_tokens += g.usage.total_tokens;
            }

            scenarioSpan.setStatus({ code: SpanStatusCode.ERROR });
            scenarioSpan.setAttribute('gcg.error.synthetic', true);

            return {
                outcome: 'error' as const,
                status_code: 500,
                security_flag: false,
                tool_calls: retries,
                cost_usd: usdFromTokens(agg),
                prompt_tokens: agg.prompt_tokens,
                output_tokens: agg.output_tokens,
                total_tokens: agg.total_tokens,
                response_text: `${g.text} (Simulated 500 after retry storm)`,
            };
        }

        if (args.scenario === 'security') {
            // block before calling the model (that’s the point)
            return {
                outcome: 'blocked' as const,
                status_code: 403,
                security_flag: true,
                tool_calls: Number(process.env.GCG_SECURITY_TOOL_CALLS || '60'),
                cost_usd: 0,
                prompt_tokens: 0,
                output_tokens: 0,
                total_tokens: 0,
                response_text: 'Blocked by gateway policy',
            };
        }

        return {
            outcome: 'ok' as const,
            status_code: 200,
            security_flag: false,
            tool_calls: 0,
            cost_usd: costByScenario.normal,
            response_text: 'OK (stubbed)',
        };
    } finally {
        scenarioSpan.end();
    }
}
