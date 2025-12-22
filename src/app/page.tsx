'use client';

import { useState } from 'react';

type Scenario = 'normal' | 'latency' | 'error' | 'security';

export default function Page() {
  const [last, setLast] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function run(scenario: Scenario) {
    setLoading(true);
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario }),
      });
      const data = await res.json();
      setLast(data);
    } finally {
      setLoading(false);
    }
  }

  function copySummary() {
    if (!last) return;
    const txt = `run_id=${last.run_id} scenario=${last.scenario} outcome=${last.outcome} trace_id=${last.trace_id ?? ''}`;
    navigator.clipboard.writeText(txt);
  }

  return (
    <main className="p-8 max-w-3xl mx-auto space-y-6">
      <h1 className="text-3xl font-semibold">Gemini Cost Guardian</h1>
      <p className="text-sm text-gray-500">
        Deterministic scenarios that drive Datadog monitors + incidents.
      </p>

      <div className="flex gap-3 flex-wrap">
        {(['normal', 'latency', 'error', 'security'] as Scenario[]).map((s) => (
          <button
            key={s}
            onClick={() => run(s)}
            disabled={loading}
            className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
          >
            {s}
          </button>
        ))}
        <a className="px-4 py-2 rounded border" href="/runs">
          Runs
        </a>
      </div>

      <section className="rounded border p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Last run</h2>
          <button onClick={copySummary} className="text-sm underline">
            Copy incident summary
          </button>
        </div>
        <pre className="mt-3 text-xs overflow-auto">
          {last ? JSON.stringify(last, null, 2) : 'No runs yet.'}
        </pre>
      </section>
    </main>
  );
}
