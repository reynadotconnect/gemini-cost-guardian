import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { addRun } from '@/lib/runStore';
import { withRunSpan } from '@/lib/telemetry';
import { runScenario } from '@/lib/scenarios';

export const runtime = 'nodejs';

export async function POST(req: Request) {
    const traffic_session = req.headers.get('x-gcg-traffic-session') ?? undefined;
    const traffic_phase = req.headers.get('x-gcg-traffic-phase') ?? undefined;
    const traffic_seq = req.headers.get('x-gcg-traffic-seq') ?? undefined;

    const body = await req.json().catch(() => ({}));
    const scenario = (body?.scenario || 'normal') as 'normal' | 'latency' | 'error' | 'security';

    const run_id = randomUUID();
    const created_at = new Date().toISOString();
    const started = Date.now();

    const { result, telemetry, trace_id } = await withRunSpan(
        { run_id, scenario, traffic_session, traffic_phase, traffic_seq },
        async runCtx => {
            const s = await runScenario({ run_id, scenario }, runCtx);
            const duration_ms = Date.now() - started;

            return {
                result: { run_id, scenario, ...s, duration_ms },
                telemetry: {
                    outcome: s.outcome,
                    status_code: s.status_code,
                    duration_ms,
                    cost_usd: s.cost_usd,
                    tool_calls: s.tool_calls,
                    security_flag: s.security_flag,
                    prompt_tokens: s.prompt_tokens || 0,
                    output_tokens: s.output_tokens || 0,
                    total_tokens: s.total_tokens || 0,
                },
            };
        }
    );

    // this is what populates /runs
    addRun({
        run_id,
        scenario,
        traffic_session,
        traffic_phase,
        traffic_seq,
        outcome: telemetry.outcome,
        status_code: telemetry.status_code,
        duration_ms: telemetry.duration_ms,
        cost_usd: telemetry.cost_usd,
        tool_calls: telemetry.tool_calls,
        security_flag: telemetry.security_flag,
        prompt_tokens: telemetry.prompt_tokens,
        output_tokens: telemetry.output_tokens,
        total_tokens: telemetry.total_tokens,
        created_at,
    });

    console.log(
        JSON.stringify({
            msg: 'gcg.run_end',
            run_id,
            scenario,
            traffic_session,
            traffic_phase,
            traffic_seq,
            outcome: telemetry.outcome,
            status_code: telemetry.status_code,
            duration_ms: telemetry.duration_ms,
            cost_usd: telemetry.cost_usd,
            tool_calls: telemetry.tool_calls,
            security_flag: telemetry.security_flag,
            trace_id,
            created_at,
        })
    );

    return NextResponse.json({ ...result, trace_id }, { status: telemetry.status_code });
}
