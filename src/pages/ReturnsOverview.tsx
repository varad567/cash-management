import ReturnApprovals from '../components/ReturnApprovals';
import { useEffect, useState } from 'react';
import { getAllReturns, type ReturnReadable } from '../lib/returnsService';

export default function ReturnsOverview() {
  const [returns, setReturns] = useState<ReturnReadable[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void getAllReturns()
      .then(setReturns)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <ReturnApprovals />
      <h2 className="text-lg font-semibold text-slate-800">Returns (All Outlets)</h2>
      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {!loading && returns.length === 0 && <p className="text-sm text-slate-500">No returns recorded.</p>}
      <div className="space-y-2">
        {returns.map((r) => (
          <div key={r.id} className="bg-white rounded-lg shadow p-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm font-medium text-slate-800">
                  {r.outlet_name} — Bill {r.bill_serial}
                </p>
                <p className="text-xs text-slate-500">{r.reason}</p>
              </div>
              <span className="text-sm font-semibold text-red-600">₹{r.amount_returned.toFixed(2)}</span>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {new Date(r.created_at).toLocaleString()} · logged by {r.created_by_name} · approved by{' '}
              {r.approved_by_name} · stock {r.stock_reversed ? 'reversed' : 'not reversed'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
