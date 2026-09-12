import { useCallback, useEffect, useState } from 'react';
import { getRegisterEntries, type RegisterEntry } from '../lib/registerEntriesService';
import { getRegisterById } from '../lib/shiftService';
import { computeExpectedClosing } from '../lib/registerMath';
import { downloadCsv } from '../lib/csvExport';
import EntriesTable from '../components/EntriesTable';
import type { ShiftRegister } from '../lib/types';

interface Props {
  register: ShiftRegister;
}

const POLL_INTERVAL_MS = 8000;

export default function Dashboard({ register: initialRegister }: Props) {
  // initialRegister is only ever fetched once, at the top of the app —
  // every trigger-driven total on it keeps changing server-side as the
  // shift goes on, so this screen holds its own live-refreshed copy
  // rather than trusting a prop that goes stale the moment any bill,
  // payment, expense, deposit, or return is recorded.
  const [register, setRegister] = useState(initialRegister);
  const [entries, setEntries] = useState<RegisterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    const [freshRegister, freshEntries] = await Promise.all([
      getRegisterById(initialRegister.id),
      getRegisterEntries(initialRegister.id),
    ]);
    setRegister(freshRegister);
    setEntries(freshEntries);
    setLastUpdated(new Date());
  }, [initialRegister.id]);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleManualRefresh() {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }

  const runningExpected = computeExpectedClosing(register);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white rounded-xl shadow p-6">
        <div className="flex justify-between items-start mb-1">
          <h2 className="text-lg font-semibold text-slate-800">
            Current Shift {register.shift_label ? `— ${register.shift_label}` : ''}
          </h2>
          <button
            onClick={() => void handleManualRefresh()}
            disabled={refreshing}
            className="text-xs text-slate-500 underline disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh now'}
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-1">
          Opened {new Date(register.opened_at).toLocaleString()}
        </p>
        <p className="text-xs text-slate-400 mb-4">Updated {lastUpdated.toLocaleTimeString()}</p>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <Stat label="Opening balance" value={register.opening_balance} />
          <Stat label="Customer credits received" value={register.credits_received ?? 0} />
          <Stat label="Cash sales" value={register.cash_sales} />
          <Stat label="Old-bill collections" value={register.cash_collected_old_bills} />
          <Stat label="Online received" value={register.online_received} />
          <Stat label="Expenses paid" value={register.expenses_paid} />
          <Stat label="Returns paid out" value={register.cash_returned} />
          <Stat label="Credits refunded" value={register.credits_refunded} />
          <Stat label="Deposits made" value={register.deposits_made} />
          <Stat label="Expected in drawer" value={runningExpected} highlight />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-slate-800">This Shift's Entries</h2>
          {entries.length > 0 && (
            <button
              onClick={() =>
                downloadCsv(
                  `${register.register_date}-current-shift-entries.csv`,
                  entries.map((e) => ({
                    time: e.created_at,
                    type: e.entry_type,
                    description: e.description,
                    amount: e.amount,
                    added_by: e.created_by_name,
                  }))
                )
              }
              className="text-xs text-slate-500 underline"
            >
              Export CSV
            </button>
          )}
        </div>
        {loading ? <p className="text-sm text-slate-500">Loading…</p> : <EntriesTable entries={entries} />}
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? 'border-slate-800 bg-slate-50' : 'border-slate-200'}`}>
      <p className="text-slate-500">{label}</p>
      <p className={`text-lg font-semibold ${highlight ? 'text-slate-900' : 'text-slate-700'}`}>
        ₹{value.toFixed(2)}
      </p>
    </div>
  );
}
