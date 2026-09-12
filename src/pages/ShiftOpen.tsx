import DenominationCounter from '../components/DenominationCounter';
import { denominationTotal, type CashDenominations } from '../lib/cashDenominations';
import { useEffect, useState } from 'react';
import { getLastClosedRegister, openShift } from '../lib/shiftService';
import { useAuth } from '../lib/AuthContext';
import type { ShiftRegister } from '../lib/types';

interface Props {
  onShiftOpened: (register: ShiftRegister) => void;
}

export default function ShiftOpen({ onShiftOpened }: Props) {
  const { appUser } = useAuth();
  const [prevRegister, setPrevRegister] = useState<ShiftRegister | null>(null);
  const [denominations, setDenominations] = useState<CashDenominations>({});
  const [confirmed, setConfirmed] = useState(false);
  const confirmedAmount = denominationTotal(denominations);
  const [shiftLabel, setShiftLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!appUser?.outlet_id) return;
    getLastClosedRegister(appUser.outlet_id)
      .then(setPrevRegister)
      .catch((err) => setError(err.message ?? 'Could not load handover'))
      .finally(() => setLoading(false));
  }, [appUser?.outlet_id]);

  const expectedHandover = prevRegister?.counted_closing ?? 0;
  const matches = confirmed && (!prevRegister || confirmedAmount === expectedHandover);

  async function handleSubmit() {
    if (!appUser?.outlet_id || !matches) return;
    setSubmitting(true);
    setError(null);
    try {
      const register = await openShift({
        outletId: appUser.outlet_id,
        denominations: Object.keys(denominations).length ? denominations : { "1": 0 },
        shiftLabel: shiftLabel || undefined,
      });
      onShiftOpened(register);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open shift');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow p-8 max-w-md w-full">
        <h1 className="text-xl font-semibold text-slate-800 mb-1">Start Your Shift</h1>
        <p className="text-sm text-slate-500 mb-6">
          {prevRegister
            ? 'Count the cash in the drawer and confirm it matches the previous shift\'s closing amount.'
            : 'This is the first shift for this outlet — enter the opening cash amount.'}
        </p>

        {prevRegister && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-slate-500">Previous shift closed with</p>
            <p className="text-2xl font-bold text-slate-800">₹{expectedHandover.toFixed(2)}</p>
          </div>
        )}

        <DenominationCounter label="Opening cash count" value={denominations} onChange={(v) => { setDenominations(v); setConfirmed(false); }} />
        <label className="flex gap-2 text-sm mb-3"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I counted and confirm these quantities, including any zero balance.</label>
        {prevRegister && confirmedAmount !== expectedHandover && <p className="text-sm text-red-600">This count must match the previous closing amount. Recount or contact your manager.</p>}

        <label className="block text-sm font-medium text-slate-700 mt-4 mb-1">
          Shift label (optional)
        </label>
        <input
          type="text"
          className="w-full border border-slate-300 rounded-lg px-4 py-2 mb-6"
          value={shiftLabel}
          onChange={(e) => setShiftLabel(e.target.value)}
          placeholder="e.g. Morning"
        />

        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        <button
          disabled={!matches || submitting || loading}
          onClick={() => void handleSubmit()}
          className="w-full bg-slate-800 text-white text-lg font-medium rounded-lg py-3 disabled:opacity-40"
        >
          {submitting ? 'Starting…' : 'Confirm & Start Shift'}
        </button>
      </div>
    </div>
  );
}
