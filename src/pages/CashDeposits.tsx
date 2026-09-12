import { useEffect, useState } from 'react';
import { createDeposit, getRecentDeposits, type CashDeposit } from '../lib/cashDepositService';
import { getOpenRegister } from '../lib/shiftService';
import { useAuth } from '../lib/AuthContext';
import { computeExpectedClosing } from '../lib/registerMath';

export default function CashDeposits() {
  const { appUser } = useAuth();
  const [amount, setAmount] = useState('');
  const [bankReference, setBankReference] = useState('');
  const [recent, setRecent] = useState<CashDeposit[]>([]);
  const [available, setAvailable] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!appUser?.outlet_id) return;
    void getRecentDeposits(appUser.outlet_id).then(setRecent);
    void refreshAvailable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appUser?.outlet_id]);

  async function refreshAvailable() {
    if (!appUser?.outlet_id) return;
    const register = await getOpenRegister(appUser.outlet_id);
    if (register) {
      setAvailable(computeExpectedClosing(register));
    }
  }

  const overLimit = available !== null && amount !== '' && Number(amount) > available;

  async function handleSubmit() {
    if (!appUser?.outlet_id || !amount) return;
    if (Number(amount) <= 0) {
      setError('Amount must be greater than zero');
      return;
    }
    if (overLimit) {
      setError(`Amount exceeds cash currently available in the drawer (₹${available?.toFixed(2)})`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createDeposit({
        outletId: appUser.outlet_id,
        amount: Number(amount),
        bankReference: bankReference || undefined,
        depositedBy: appUser.id,
      });
      setAmount('');
      setBankReference('');
      setRecent(await getRecentDeposits(appUser.outlet_id));
      await refreshAvailable();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save deposit');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Cash Deposit (Drawer → Bank)</h2>
        {available !== null && (
          <p className="text-sm text-slate-500 mb-3">
            Available in drawer: <span className="font-medium text-slate-700">₹{available.toFixed(2)}</span>
          </p>
        )}
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          max={available ?? undefined}
          className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-1"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        {overLimit && (
          <p className="text-sm text-red-600 mb-2">
            Can't exceed the available drawer amount (₹{available?.toFixed(2)}).
          </p>
        )}
        <div className={overLimit ? '' : 'mb-2'} />
        <input
          className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-4"
          placeholder="Bank reference (optional)"
          value={bankReference}
          onChange={(e) => setBankReference(e.target.value)}
        />
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        <button
          disabled={!amount || overLimit || submitting}
          onClick={() => void handleSubmit()}
          className="w-full bg-slate-800 text-white font-medium rounded-lg py-3 disabled:opacity-40"
        >
          {submitting ? 'Saving…' : 'Log Deposit'}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Recent Deposits</h2>
        {recent.length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
        <ul className="space-y-2">
          {recent.map((d) => (
            <li key={d.id} className="flex justify-between text-sm border-b border-slate-100 pb-2">
              <span>{d.bank_reference || 'Deposit'}</span>
              <span className="font-medium">₹{d.amount.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
