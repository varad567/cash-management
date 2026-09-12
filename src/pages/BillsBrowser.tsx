import { useEffect, useState } from 'react';
import { searchBills } from '../lib/billService';
import type { Bill, BillStatus } from '../lib/types';
import { businessDate } from '../lib/cashDenominations';
import { billCsvRow, getBillsForExport } from '../lib/billExportService';
import { downloadCsv } from '../lib/csvExport';

const STATUS_OPTIONS: BillStatus[] = ['open', 'partial', 'paid', 'cancelled'];

const STATUS_STYLES: Record<BillStatus, string> = {
  open: 'bg-amber-50 text-amber-700',
  partial: 'bg-blue-50 text-blue-700',
  paid: 'bg-green-50 text-green-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

export default function BillsBrowser() {
  const [serial, setSerial] = useState('');
  const [status, setStatus] = useState<BillStatus | ''>('');
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(businessDate());
  const [to, setTo] = useState(businessDate());
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');

  async function exportBills() {
    setExporting(true); setMessage('');
    try {
      const rows = await getBillsForExport({ from, to, serial, status });
      if (!rows.length) { setMessage('No bills match this date range and these filters.'); return; }
      const timestamp = new Date().toISOString();
      downloadCsv(`bill-reconciliation-${from}-to-${to}.csv`, rows.map((b) => billCsvRow(b, timestamp)));
      setMessage(`Exported ${rows.length} bills.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Export failed. Please retry.'); }
    finally { setExporting(false); }
  }

  useEffect(() => {
    setLoading(true);
    void searchBills({ serial: serial || undefined, status: status || undefined })
      .then(setBills)
      .finally(() => setLoading(false));
  }, [serial, status]);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="bg-white p-4 rounded-lg space-y-3">
        <h1 className="font-semibold">Billing-software reconciliation CSV</h1>
        <p className="text-sm text-slate-600">One row per bill, with cash and online payments shown separately. Dates select bills by their register date in India; payment totals include collections made later, up to export time. Export includes all matching bills across your permitted outlets.</p>
        <div className="flex flex-wrap gap-3 items-end">
          <label>From<input aria-label="Export from date" className="block border rounded p-2" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To<input aria-label="Export to date" className="block border rounded p-2" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button onClick={() => void exportBills()} disabled={exporting} className="bg-slate-800 text-white px-4 py-2 rounded disabled:opacity-40">{exporting ? 'Exporting…' : 'Export bill CSV'}</button>
        </div>
        <p className="text-xs text-slate-500">Uses the bill number and status filters below. For comparison, match bill number + outlet. Import bill numbers as text to preserve leading zeros. Export during a quiet period if payments are still being entered.</p>
        {message && <p role="status" className="text-sm">{message}</p>}
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 border border-slate-300 rounded-lg px-4 py-3"
          placeholder="Search by bill serial…"
          value={serial}
          onChange={(e) => setSerial(e.target.value)}
        />
        <select
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value as BillStatus | '')}
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {!loading && bills.length === 0 && <p className="text-sm text-slate-500">No bills found.</p>}

      <div className="space-y-2">
        {bills.map((b) => (
          <div key={b.id} className="bg-white rounded-lg shadow p-4 flex justify-between items-center">
            <div>
              <p className="font-medium text-slate-800">{b.bill_serial}</p>
              <p className="text-xs text-slate-500">
                {b.bill_type === 'admitted_patient' ? 'Admitted patient' : 'Walk-in'}
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-slate-800">₹{b.bill_amount.toFixed(2)}</p>
              {b.balance_due > 0 && (
                <p className="text-xs text-red-600">Balance ₹{b.balance_due.toFixed(2)}</p>
              )}
            </div>
            <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_STYLES[b.status]}`}>
              {b.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
