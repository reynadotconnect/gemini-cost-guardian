'use client';

import { useEffect, useState } from 'react';

export default function RunsPage() {
  const [runs, setRuns] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      const res = await fetch('/api/runs');
      const data = await res.json();
      setRuns(data.runs || []);
    };
    load();
    const id = setInterval(load, 1500);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="p-8 max-w-5xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">Runs (last 20)</h1>
      <a className="underline text-sm" href="/">
        ← Back
      </a>

      <div className="overflow-auto border rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-left">created</th>
              <th className="p-2 text-left">scenario</th>
              <th className="p-2 text-left">outcome</th>
              <th className="p-2 text-left">duration_ms</th>
              <th className="p-2 text-left">cost_usd</th>
              <th className="p-2 text-left">tool_calls</th>
              <th className="p-2 text-left">security</th>
              <th className="p-2 text-left">run_id</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.run_id} className="border-t">
                <td className="p-2">{r.created_at}</td>
                <td className="p-2">{r.scenario}</td>
                <td className="p-2">{r.outcome}</td>
                <td className="p-2">{r.duration_ms}</td>
                <td className="p-2">{r.cost_usd}</td>
                <td className="p-2">{r.tool_calls}</td>
                <td className="p-2">{String(r.security_flag)}</td>
                <td className="p-2 font-mono text-xs">{r.run_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
