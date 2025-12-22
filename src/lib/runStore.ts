export type RunRecord = {
  run_id: string;
  scenario: 'normal' | 'latency' | 'error' | 'security';
  outcome: 'ok' | 'error' | 'blocked';
  status_code: number;
  duration_ms: number;
  cost_usd: number;
  tool_calls: number;
  security_flag: boolean;
  created_at: string;
};

const runs: RunRecord[] = [];

export function addRun(r: RunRecord) {
  runs.unshift(r);
  if (runs.length > 20) runs.length = 20;
}

export function listRuns() {
  return runs;
}
