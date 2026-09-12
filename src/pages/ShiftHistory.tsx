import DenominationCounter from '../components/DenominationCounter';
import { useEffect, useState } from 'react';
import { getClosedRegisters, type ShiftRegisterReadable } from '../lib/shiftHistoryService';
import { getRegisterEntries, type RegisterEntry } from '../lib/registerEntriesService';
import { downloadCsv } from '../lib/csvExport';
import EntriesTable from '../components/EntriesTable';

export default function ShiftHistory() {
  const [registers, setRegisters] = useState<ShiftRegisterReadable[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ShiftRegisterReadable | null>(null);
  const [entries, setEntries] = useState<RegisterEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);

  useEffect(() => {
    void getClosedRegisters()
      .then(setRegisters)
      .finally(() => setLoading(false));
  }, []);

  async function openDetail(reg: ShiftRegisterReadable) {
    setSelected(reg);
    setEntriesLoading(true);
    try {
      setEntries(await getRegisterEntries(reg.id));
    } finally {
      setEntriesLoading(false);
    }
  }

  if (selected) {
    const mismatch = selected.mismatch ?? 0;
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <button onClick={() => setSelected(null)} className="text-sm text-slate-600 underline">
          ← Back to shift history
        </button>
        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold text-slate-800">
            {selected.outlet_name} — {selected.shift_label || 'Shift'}
          </h2>
          <p className="text-sm text-slate-500 mb-4">
            {new Date(selected.opened_at).toLocaleString()} → {selected.closed_at && new Date(selected.closed_at).toLocaleString()}
          </p>
          <div className="grid grid-cols-2 gap-3 text-sm mb-2">
            <Stat label="Opened by" value={selected.opened_by_name} text />
            <Stat label="Closed by" value={selected.closed_by_name ?? '—'} text />
            <Stat label="Expected closing" value={`₹${(selected.expected_closing ?? 0).toFixed(2)}`} text />
            <Stat label="Counted closing" value={`₹${(selected.counted_closing ?? 0).toFixed(2)}`} text />
          </div>
          <p className={`text-xl font-bold mt-2 ${mismatch === 0 ? 'text-green-600' : 'text-red-600'}`}>
            {mismatch === 0 ? 'Matched ✓' : `Mismatch: ₹${mismatch.toFixed(2)}`}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow p-6 grid md:grid-cols-2 gap-4">
          {selected.opening_denominations ? <DenominationCounter label="Opening cash count" value={selected.opening_denominations} /> : <p>No denomination counts recorded for this older opening.</p>}
          {selected.closing_denominations ? <DenominationCounter label="Closing cash count" value={selected.closing_denominations} /> : <p>No denomination counts recorded for this older closing.</p>}
        </div>
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-medium text-slate-800">Entries</h3>
            {entries.length > 0 && (
              <button
                onClick={() =>
                  downloadCsv(
                    `${selected.outlet_name}-${selected.register_date}-entries.csv`,
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
          {entriesLoading ? <p className="text-sm text-slate-500">Loading…</p> : <EntriesTable entries={entries} />}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-800 mb-4">Shift History</h2>
      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {!loading && registers.length === 0 && (
        <p className="text-sm text-slate-500">No closed shifts yet.</p>
      )}
      <div className="space-y-2">
        {registers.map((r) => {
          const mismatch = r.mismatch ?? 0;
          return (
            <button
              key={r.id}
              onClick={() => void openDetail(r)}
              className="w-full text-left bg-white rounded-lg shadow p-4 flex justify-between items-center hover:bg-slate-50"
            >
              <div>
                <p className="font-medium text-slate-800">
                  {r.outlet_name} — {r.shift_label || 'Shift'}
                </p>
                <p className="text-xs text-slate-500">
                  {r.closed_at && new Date(r.closed_at).toLocaleString()} · opened by {r.opened_by_name}
                </p>
              </div>
              <span
                className={`text-sm font-semibold ${mismatch === 0 ? 'text-green-600' : 'text-red-600'}`}
              >
                {mismatch === 0 ? 'Matched' : `₹${mismatch.toFixed(2)}`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, text }: { label: string; value: string | number; text?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-slate-500 text-xs">{label}</p>
      <p className="font-semibold text-slate-800">{text ? value : `₹${Number(value).toFixed(2)}`}</p>
    </div>
  );
}
