import { useEffect, useState } from 'react';
import { createCredit, getHeldCredits, refundCredit, applyCreditToBill, type CustomerCredit } from '../lib/customerCreditService';
import { findBillBySerial } from '../lib/returnsService';
import { useAuth } from '../lib/AuthContext';

export default function CustomerCredits() {
  const { appUser } = useAuth();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [held, setHeld] = useState<CustomerCredit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // "Use against bill" flow, per credit row
  const [usingCreditId, setUsingCreditId] = useState<string | null>(null);
  const [billSerial, setBillSerial] = useState('');
  const [applying, setApplying] = useState(false);

  async function refresh() {
    if (!appUser?.outlet_id) return;
    setHeld(await getHeldCredits(appUser.outlet_id));
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appUser?.outlet_id]);

  async function handleCreate() {
    if (!appUser?.outlet_id || !amount || !reason) return;
    if (Number(amount) <= 0) {
      setError('Amount must be greater than zero');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createCredit({
        outletId: appUser.outlet_id,
        amount: Number(amount),
        reason,
        createdBy: appUser.id,
      });
      setAmount('');
      setReason('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log credit');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApply(creditId: string) {
    if (!appUser?.outlet_id || !billSerial) return;
    setApplying(true);
    setError(null);
    try {
      const bill = await findBillBySerial(appUser.outlet_id, billSerial.trim());
      if (!bill) {
        setError('No bill found with that serial at this outlet');
        return;
      }
      await applyCreditToBill(creditId, bill.id);
      setUsingCreditId(null);
      setBillSerial('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply credit');
    } finally {
      setApplying(false);
    }
  }

  async function handleRefund(creditId: string) {
    if (!window.confirm('Mark this credit as refunded to the customer?')) return;
    setError(null);
    try {
      await refundCredit(creditId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refund credit');
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-1">Log Customer Credit</h2>
        <p className="text-sm text-slate-500 mb-4">
          For excess/round-up amounts held for a customer — not a return, not an expense.
        </p>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-3"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <input
          className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-4"
          placeholder="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        <button
          disabled={!amount || !reason || submitting}
          onClick={() => void handleCreate()}
          className="w-full bg-slate-800 text-white font-medium rounded-lg py-3 disabled:opacity-40"
        >
          {submitting ? 'Saving…' : 'Log Credit'}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Held Credits</h2>
        {held.length === 0 && <p className="text-sm text-slate-500">None held.</p>}
        <div className="space-y-3">
          {held.map((c) => (
            <div key={c.id} className="border border-slate-200 rounded-lg p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium text-slate-800">{c.reason}</p>
                  <p className="text-xs text-slate-500">{new Date(c.created_at).toLocaleDateString()}</p>
                </div>
                <p className="font-semibold text-slate-800">₹{c.amount.toFixed(2)}</p>
              </div>
              {usingCreditId === c.id ? (
                <div className="mt-3 flex gap-2">
                  <input
                    className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="Bill serial to apply against"
                    value={billSerial}
                    onChange={(e) => setBillSerial(e.target.value)}
                  />
                  <button
                    onClick={() => void handleApply(c.id)}
                    disabled={!billSerial || applying}
                    className="text-sm bg-slate-800 text-white rounded-lg px-3 disabled:opacity-40"
                  >
                    {applying ? 'Applying…' : 'Apply'}
                  </button>
                  <button
                    onClick={() => {
                      setUsingCreditId(null);
                      setBillSerial('');
                    }}
                    className="text-sm border border-slate-300 rounded-lg px-3"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setUsingCreditId(c.id)}
                    className="text-sm border border-slate-300 rounded-lg px-3 py-1.5"
                  >
                    Use against a bill
                  </button>
                  <button
                    onClick={() => void handleRefund(c.id)}
                    className="text-sm border border-slate-300 rounded-lg px-3 py-1.5"
                  >
                    Refund to customer
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
