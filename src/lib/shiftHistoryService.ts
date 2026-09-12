import type { CashDenominations } from './cashDenominations';
import { supabase } from './supabaseClient';

export interface ShiftRegisterReadable {
  id: string;
  outlet_id: string;
  outlet_name: string;
  register_date: string;
  shift_label: string | null;
  opening_balance: number;
  cash_sales: number;
  cash_collected_old_bills: number;
  online_received: number;
  expenses_paid: number;
  deposits_made: number;
  cash_returned: number;
  credits_refunded: number;
  credits_received: number;
  opening_denominations: CashDenominations | null;
  closing_denominations: CashDenominations | null;
  expected_closing: number | null;
  counted_closing: number | null;
  mismatch: number | null;
  status: string;
  opened_by_name: string;
  closed_by_name: string | null;
  opened_at: string;
  closed_at: string | null;
}

// RLS on shift_registers already scopes this correctly per caller:
// a cashier/manager only ever sees their own outlet's history, HQ/
// audit see every outlet — no separate outlet filter needed here.
export async function getClosedRegisters(limit = 30): Promise<ShiftRegisterReadable[]> {
  const { data, error } = await supabase
    .from('shift_registers_readable')
    .select('*')
    .eq('status', 'closed')
    .order('closed_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as ShiftRegisterReadable[];
}
