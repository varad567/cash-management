import { useEffect, useState } from 'react';
import { approveExpense, getExpensesForApproval, getReceiptSignedUrl, type ExpenseReadable } from '../lib/expenseService';
import { useAuth } from '../lib/AuthContext';

export default function ExpenseApprovals() {
  const { appUser } = useAuth();
  const [expenses, setExpenses] = useState<ExpenseReadable[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canApprove = appUser?.role === 'hq';

  async function refresh() {
    setExpenses(await getExpensesForApproval());
  }

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, []);

  async function handleApprove(expenseId: string) {
    if (!appUser) return;
    setApprovingId(expenseId);
    setError(null);
    try {
      await approveExpense(expenseId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not approve expense');
    } finally {
      setApprovingId(null);
    }
  }

  async function handleViewReceipt(receiptPath: string | null) {
    if (!receiptPath) return;
    try {
      const url = await getReceiptSignedUrl(receiptPath);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open receipt');
    }
  }

  const pending = expenses.filter((e) => !e.approved_by);
  const approved = expenses.filter((e) => e.approved_by);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Expense Approvals</h2>
        <p className="text-sm text-slate-500">Expenses flagged for HQ sign-off, across all outlets.</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Loading…</p>}

      {!loading && (
        <>
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="font-medium text-slate-800 mb-4">
              Pending ({pending.length})
            </h3>
            {pending.length === 0 && <p className="text-sm text-slate-500">Nothing waiting on approval.</p>}
            <div className="space-y-3">
              {pending.map((e) => (
                <div key={e.id} className="border border-slate-200 rounded-lg p-4 flex justify-between items-start">
                  <div>
                    <p className="font-medium text-slate-800">{e.reason}</p>
                    <p className="text-xs text-slate-500">
                      {e.outlet_name} · logged by {e.created_by_name} ·{' '}
                      {new Date(e.created_at).toLocaleString()}
                    </p>
                    {e.receipt_url && (
                      <button
                        onClick={() => void handleViewReceipt(e.receipt_url)}
                        className="text-xs text-slate-500 underline mt-1"
                      >
                        View receipt
                      </button>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-slate-800 mb-2">₹{e.amount.toFixed(2)}</p>
                    {canApprove ? (
                      <button
                        onClick={() => void handleApprove(e.id)}
                        disabled={approvingId === e.id}
                        className="text-sm bg-slate-800 text-white rounded-lg px-3 py-1.5 disabled:opacity-40"
                      >
                        {approvingId === e.id ? 'Approving…' : 'Approve'}
                      </button>
                    ) : (
                      <p className="text-xs text-slate-400">HQ only</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="font-medium text-slate-800 mb-4">Recently Approved</h3>
            {approved.length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
            <div className="space-y-2">
              {approved.map((e) => (
                <div key={e.id} className="flex justify-between text-sm border-b border-slate-100 pb-2">
                  <span>
                    {e.outlet_name} — {e.reason}
                  </span>
                  <span className="text-slate-500">
                    ₹{e.amount.toFixed(2)} · approved by {e.approved_by_name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
