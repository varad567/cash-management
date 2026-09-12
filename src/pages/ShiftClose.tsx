import DenominationCounter from '../components/DenominationCounter';
import { type CashDenominations } from '../lib/cashDenominations';
import { useCallback, useEffect, useState } from 'react';
import { closeShift, getRegisterById } from '../lib/shiftService';
import { computeExpectedClosing } from '../lib/registerMath';
import { useAuth } from '../lib/AuthContext';
import type { ShiftRegister } from '../lib/types';

interface Props {
  register: ShiftRegister;
  onClosed: () => void;
  onCancel: () => void;
}

const POLL_INTERVAL_MS = 8000;

export default function ShiftClose({ register: initialRegister, onClosed, onCancel }: Props) {
  const { appUser } = useAuth();
  // The register prop can be arbitrarily stale (fetched once, minutes
  // or hours ago, at app load) — every field it shows here keeps
  // changing server-side as the shift runs. This screen always shows
  // a freshly re-fetched copy, polled while open, so what the cashier
  // sees can't drift from what closeShift() will actually compute.
  const [register, setRegister] = useState(initialRegister);
  const [refreshedOnce, setRefreshedOnce] = useState(false);
  const [denominations, setDenominations] = useState<CashDenominations>({});
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShiftRegister | null>(null);

  const refresh = useCallback(async () => {
    setRegister(await getRegisterById(initialRegister.id));
    setRefreshedOnce(true);
  }, [initialRegister.id]);

  useEffect(() => {
    void refresh().catch((err) => setError(err.message));
    const interval = setInterval(() => void refresh().catch((err) => setError(err.message)), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const runningExpected = computeExpectedClosing(register);

  async function handleSubmit() {
    if (!appUser || !confirmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const closed = await closeShift({
        registerId: register.id,
        denominations: Object.keys(denominations).length ? denominations : { "1": 0 },
      });
      setResult(closed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close shift');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    const mismatch = result.mismatch ?? 0;
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow p-8 max-w-md w-full text-center">
          <h1 className="text-xl font-semibold text-slate-800 mb-4">Shift Closed</h1>
          <p className="text-sm text-slate-500">Expected</p>
          <p className="text-lg font-medium">₹{result.expected_closing?.toFixed(2)}</p>
          <p className="text-sm text-slate-500 mt-3">Counted</p>
          <p className="text-lg font-medium">₹{result.counted_closing?.toFixed(2)}</p>
          <p
            className={`mt-4 text-2xl font-bold ${mismatch === 0 ? 'text-green-600' : 'text-red-600'}`}
          >
            {mismatch === 0 ? 'Matched ✓' : `Mismatch: ₹${mismatch.toFixed(2)}`}
          </p>
          {mismatch !== 0 && (
            <p className="text-xs text-slate-500 mt-2">
              This will be flagged for the audit team. The next cashier will confirm this
              counted amount when they open their shift.
            </p>
          )}
          <button
            onClick={onClosed}
            className="mt-6 w-full bg-slate-800 text-white font-medium rounded-lg py-3"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow p-8 max-w-md w-full">
        <h1 className="text-xl font-semibold text-slate-800 mb-1">Close Your Shift</h1>
        <p className="text-sm text-slate-500 mb-6">Count the notes and coins in the drawer.</p>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4 text-sm space-y-1">
          {!refreshedOnce && <p className="text-slate-400 text-xs mb-2">Loading latest totals…</p>}
          <Row label="Opening balance" value={register.opening_balance} />
          <Row label="Customer credits received" value={register.credits_received ?? 0} />
          <Row label="Cash sales" value={register.cash_sales} />
          <Row label="Old-bill collections" value={register.cash_collected_old_bills} />
          <Row label="Expenses paid" value={-register.expenses_paid} />
          <Row label="Deposits made" value={-register.deposits_made} />
          <Row label="Returns paid out" value={-register.cash_returned} />
          <Row label="Credits refunded" value={-register.credits_refunded} />
          <div className="border-t border-slate-200 pt-1 mt-1 flex justify-between font-semibold">
            <span>System-expected closing</span>
            <span>₹{runningExpected.toFixed(2)}</span>
          </div>
        </div>

        <DenominationCounter label="Closing cash count" value={denominations} onChange={(v) => { setDenominations(v); setConfirmed(false); }} />
        <label className="flex gap-2 text-sm mb-4"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I counted and confirm these quantities, including any zero balance.</label>

        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 border border-slate-300 text-slate-700 font-medium rounded-lg py-3"
          >
            Back
          </button>
          <button
            disabled={!confirmed || submitting || !refreshedOnce}
            onClick={() => void handleSubmit()}
            className="flex-1 bg-slate-800 text-white font-medium rounded-lg py-3 disabled:opacity-40"
          >
            {submitting ? 'Closing…' : 'Confirm Close'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-slate-600">
      <span>{label}</span>
      <span>{value < 0 ? '-' : ''}₹{Math.abs(value).toFixed(2)}</span>
    </div>
  );
}
