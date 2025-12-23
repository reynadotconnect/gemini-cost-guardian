export type RunRecord = {
    run_id: string;
    scenario: string;
    outcome: string;
    status_code: number;
    duration_ms: number;
    cost_usd: number;
    tool_calls: number;
    security_flag: boolean;
    created_at: string;
};

declare global {
    // eslint-disable-next-line no-var
    var __gcgRuns: RunRecord[] | undefined;
}

function store(): RunRecord[] {
    if (!globalThis.__gcgRuns) globalThis.__gcgRuns = [];
    return globalThis.__gcgRuns;
}

export function addRun(r: RunRecord) {
    const s = store();
    s.unshift(r);
    if (s.length > 20) s.length = 20;
}

export function getRuns(limit = 20): RunRecord[] {
    return store().slice(0, limit);
}
