import { businessDate } from './cashDenominations';
import { queueAction } from './offlineQueue';
import { supabase } from './supabaseClient';
import type { Bill } from './types';

export async function findBillBySerial(outletId: string, billSerial: string): Promise<Bill | null> {
  const { data, error } = await supabase
    .from('bills')
    .select('*')
    .eq('outlet_id', outletId)
    .eq('bill_serial', billSerial)
    .maybeSingle();
  if (error) throw error;
  return data as Bill | null;
}

// Friendly, immediate check before submission — bills.bill_serial has
// a DB-level unique constraint per outlet (the real backstop), but
// most duplicate entries are just a typo the cashier can fix on the
// spot rather than something that should fail silently in the
// background sync queue.
export async function billSerialExists(outletId: string, billSerial: string): Promise<boolean> {
  return (await findBillBySerial(outletId, billSerial)) !== null;
}

// Sum of everything already returned against this bill — the server
// also re-checks this at insert time (migration 0010), but the UI
// needs it up front so the cashier isn't guessing at a valid amount.
export async function getReturnedSoFar(billId: string): Promise<number> {
  const { data, error } = await supabase
    .from('returns')
    .select('amount_returned')
    .eq('original_bill_id', billId);
  if (error) throw error;
  return (data ?? []).reduce((sum, r) => sum + Number(r.amount_returned), 0);
}

interface CreateReturnParams {
  outletId: string;
  originalBillId: string;
  amountReturned: number;
  reason: string;
  stockReversed: boolean;
  createdBy: string;
}

// Queues a return request; cash moves only after a manager or HQ approves it.
export async function createReturn(params: CreateReturnParams) {
  return queueAction('returns', 'insert', {
    outlet_id: params.outletId,
    original_bill_id: params.originalBillId,
    amount_returned: params.amountReturned,
    reason: params.reason,
    stock_reversed: params.stockReversed,
    register_date: businessDate(),
    created_by: params.createdBy,
  });
}

export interface ReturnReadable {
  id: string;
  outlet_id: string;
  outlet_name: string;
  bill_serial: string;
  amount_returned: number;
  reason: string;
  stock_reversed: boolean;
  created_by_name: string;
  approved_by_name: string;
  created_at: string;
}

// Cross-outlet browsing for HQ/audit — RLS on `returns` already
// scopes this per caller (own outlet only for cashier/manager, all
// outlets for HQ/audit), same pattern as shift history.
export async function getAllReturns(limit = 50): Promise<ReturnReadable[]> {
  const { data, error } = await supabase
    .from('returns_readable')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as ReturnReadable[];
}
