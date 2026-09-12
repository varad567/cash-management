import { supabase } from './supabaseClient';

export interface BillExportFilters { from: string; to: string; serial?: string; status?: string; outletId?: string; }
export interface ReconciliationBill {
  id: string; outlet_id: string; outlet_name: string; bill_serial: string; register_date: string; created_at: string;
  bill_type: string; bill_amount: number; cash_paid: number; online_paid: number; credit_applied: number;
  amount_paid: number; payment_total: number; balance_due: number; returned_amount: number;
  ledger_difference: number; status: string; online_references: string;
}
export function billCsvRow(b: ReconciliationBill, exportedAt: string): Record<string, unknown> {
  return { bill_number: b.bill_serial, bill_date: b.register_date, outlet: b.outlet_name, bill_type: b.bill_type,
    bill_amount: Number(b.bill_amount).toFixed(2), cash_paid: Number(b.cash_paid).toFixed(2),
    online_paid: Number(b.online_paid).toFixed(2), credit_applied: Number(b.credit_applied).toFixed(2),
    total_paid: Number(b.amount_paid).toFixed(2), ledger_payment_total: Number(b.payment_total).toFixed(2),
    balance_due: Number(b.balance_due).toFixed(2), returned_amount: Number(b.returned_amount).toFixed(2),
    ledger_difference: Number(b.ledger_difference), status: b.status, online_references: b.online_references,
    bill_id: b.id, outlet_id: b.outlet_id, exported_at: exportedAt };
}
export async function getBillsForExport(filters: BillExportFilters): Promise<ReconciliationBill[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filters.from) || !/^\d{4}-\d{2}-\d{2}$/.test(filters.to) || filters.from > filters.to) throw new Error('Choose a valid date range.');
  const rows: ReconciliationBill[] = [];
  let cursor: string | undefined;
  // Capture a creation cutoff and use a stable keyset, never the screen's 30-row limit.
  const cutoff = new Date().toISOString();
  for (;;) {
    let query = supabase.from('bill_reconciliation').select('*').gte('register_date', filters.from).lte('register_date', filters.to)
      .lte('created_at', cutoff).order('id', { ascending: true }).limit(500);
    if (cursor) query = query.gt('id', cursor);
    if (filters.serial?.trim()) query = query.ilike('bill_serial', `%${filters.serial.trim()}%`);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.outletId) query = query.eq('outlet_id', filters.outletId);
    const { data, error } = await query;
    if (error) throw error;
    const page = (data ?? []) as ReconciliationBill[];
    rows.push(...page);
    if (page.length === 0) break;
    cursor = page[page.length - 1].id;
  }
  return rows.sort((a, b) => a.register_date.localeCompare(b.register_date) || a.bill_serial.localeCompare(b.bill_serial));
}
