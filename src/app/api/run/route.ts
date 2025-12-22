import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { addRun } from '@/lib/runStore';
import { withRunSpan } from '@/lib/telemetry';
import { runScenario } from '@/lib/scenarios';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const scenario = (body?.scenario || 'normal') as 'normal' | 'latency' | 'error' | 'security';

  const run_id = randomUUID();
  const created_at = new Date().toISOString();
  const started = Date.now();

  const { result, telemetry, trace_id } = await withRunSpan({ run_id, scenario }, async () => {
    const s = await runScenario({ run_id, scenario });
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
      },
    };
  });

  // ✅ this is what populates /runs
  addRun({
    run_id,
    scenario,
    outcome: telemetry.outcome,
    status_code: telemetry.status_code,
    duration_ms: telemetry.duration_ms,
    cost_usd: telemetry.cost_usd,
    tool_calls: telemetry.tool_calls,
    security_flag: telemetry.security_flag,
    created_at,
  });

  console.log(
    JSON.stringify({
      msg: 'gcg.run_end',
      run_id,
      scenario,
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
