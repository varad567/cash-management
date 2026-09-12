import { validateSplit, toPaise } from './cashDenominations';
import { queueAction } from './offlineQueue';
import { supabase } from './supabaseClient';
import type { Bill, BillStatus, BillType, PaymentMode } from './types';

export interface CreateSaleParams {
  outletId: string; billSerial: string; billType: BillType; admissionId: string | null;
  billAmount: number; cashAmount: number; onlineAmount: number; gatewayReference?: string;
}
export async function createSale(p: CreateSaleParams) {
  validateSplit(p.billAmount, p.cashAmount, p.onlineAmount, p.billType === 'walk_in', p.gatewayReference ?? '');
  return queueAction('sale', 'rpc', { outlet_id: p.outletId, bill_serial: p.billSerial.trim(),
    bill_type: p.billType, admission_id: p.admissionId, bill_amount: p.billAmount,
    cash_amount: p.cashAmount, online_amount: p.onlineAmount, gateway_reference: p.gatewayReference?.trim() || null });
}
interface RecordPaymentParams {
  billId: string; outletId: string; amount: number; mode: PaymentMode; gatewayReference?: string; receivedBy: string;
}
export async function recordPayment(p: RecordPaymentParams) {
  if (toPaise(p.amount) <= 0) throw new Error('Payment must be greater than zero.');
  if (p.mode === 'online' && !p.gatewayReference?.trim()) throw new Error('Online payments require a reference.');
  return queueAction('payments', 'insert', { bill_id: p.billId, outlet_id: p.outletId, amount: p.amount,
    mode: p.mode, gateway_reference: p.gatewayReference?.trim() || null, received_by: p.receivedBy });
}

// Admitted-patient bills carrying a balance from an earlier shift —
// the actual UI for the "carried forward 2-3 days, paid off later"
// case. Excludes fully paid/cancelled bills so a cashier can only
// ever select something that genuinely still owes money.
export async function getPayableBillsForAdmission(admissionId: string): Promise<Bill[]> {
  const { data, error } = await supabase
    .from('bills')
    .select('*')
    .eq('admission_id', admissionId)
    .in('status', ['open', 'partial'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as Bill[];
}

// Searchable bill browsing — outlet-scoped for cashier/manager
// (via RLS), cross-outlet for HQ/audit automatically. Supersedes the
// old getRecentBills, which was written in Phase 1 and never
// actually wired to any screen.
interface SearchBillsParams {
  serial?: string;
  status?: BillStatus;
  limit?: number;
}

export async function searchBills(params: SearchBillsParams = {}): Promise<Bill[]> {
  let query = supabase
    .from('bills')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(params.limit ?? 30);

  if (params.serial) {
    query = query.ilike('bill_serial', `%${params.serial.trim()}%`);
  }
  if (params.status) {
    query = query.eq('status', params.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data as Bill[];
}
