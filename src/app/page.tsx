'use client';

import { useState } from 'react';

type ScenarioKey = 'normal' | 'latency' | 'error' | 'security';

const SCENARIOS: { key: ScenarioKey; label: string }[] = [
  { key: 'normal', label: 'Normal' },
  { key: 'latency', label: 'Latency' },
  { key: 'error', label: 'Error Storm' },
  { key: 'security', label: 'Security Event' },
];

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
      aria-label="loading"
    />
  );
}

export default function Page() {
  const [last, setLast] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [activeScenario, setActiveScenario] = useState<ScenarioKey | null>(null);
  const [showRunning, setShowRunning] = useState(false);

  async function run(scenario: ScenarioKey) {
    setLoading(true);
    setActiveScenario(scenario);
    setShowRunning(false);

    let didShow = false;
    const startedAt = Date.now();

    // Don't show "Running..." unless the request lasts > 250ms
    const showTimer = setTimeout(() => {
      didShow = true;
      setShowRunning(true);
    }, 250);

    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario }),
      });
      const data = await res.json();
      setLast({ http_status: res.status, ...data });
    } catch (e: any) {
      setLast({ error: 'request_failed', message: String(e?.message ?? e) });
    } finally {
      clearTimeout(showTimer);

      // If we showed it, keep it visible for at least 400ms total
      if (didShow) {
        const elapsed = Date.now() - startedAt;
        const minVisible = 400;
        if (elapsed < minVisible) {
          await new Promise((r) => setTimeout(r, minVisible - elapsed));
        }
      }

      setLoading(false);
      setShowRunning(false);
      setActiveScenario(null);
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
        {SCENARIOS.map((s) => (
          <button
            key={s.key}
            onClick={() => run(s.key)}
            disabled={loading}
            className="px-4 py-2 rounded bg-black text-white disabled:opacity-50 inline-flex items-center gap-2"
          >
            {loading && activeScenario === s.key && showRunning ? (
              <>
                <Spinner />
                Running…
              </>
            ) : (
              s.label
            )}
          </button>
        ))}

        <a href="/runs" className="px-4 py-2 rounded border border-gray-300 bg-white text-gray-900 hover:bg-gray-50">
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

        {loading && activeScenario && showRunning ? (
          <div className="mt-3 text-sm text-gray-600">Running scenario…</div>
        ) : (
          <pre className="mt-3 text-xs overflow-auto">
            {last ? JSON.stringify(last, null, 2) : 'No runs yet.'}
          </pre>
        )}
      </section>
    </main>
  );
}
