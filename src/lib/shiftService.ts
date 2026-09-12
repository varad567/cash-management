import { supabase } from './supabaseClient';
import { getUnresolvedCount } from './offlineQueue';
import type { CashDenominations } from './cashDenominations';
import type { ShiftRegister } from './types';

// The currently open register for an outlet, or null if none is open.
export async function getOpenRegister(outletId: string): Promise<ShiftRegister | null> {
  const { data, error } = await supabase
    .from('shift_registers')
    .select('*')
    .eq('outlet_id', outletId)
    .eq('status', 'open')
    .maybeSingle();
  if (error) throw error;
  return data as ShiftRegister | null;
}

// The most recently closed register for an outlet — used to show the
// incoming cashier the amount they must confirm to open the next shift.
export async function getLastClosedRegister(outletId: string): Promise<ShiftRegister | null> {
  const { data, error } = await supabase
    .from('shift_registers')
    .select('*')
    .eq('outlet_id', outletId)
    .eq('status', 'closed')
    .order('closed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as ShiftRegister | null;
}

// A single register's current live state, by id. The register held
// in top-level app state is fetched once and never updated after —
// every trigger-driven total (cash_sales, expenses_paid, etc.) keeps
// changing server-side as the shift goes on, so any screen showing
// those numbers or computing the expected-closing preview needs to
// re-fetch this, not trust a prop that may be minutes stale.
export async function getRegisterById(registerId: string): Promise<ShiftRegister> {
  const { data, error } = await supabase
    .from('shift_registers')
    .select('*')
    .eq('id', registerId)
    .single();
  if (error) throw error;
  return data as ShiftRegister;
}

interface OpenShiftParams {
  outletId: string;
  denominations: CashDenominations;
  shiftLabel?: string;
}

export async function openShift({ outletId, denominations, shiftLabel }: OpenShiftParams) {
  const { data, error } = await supabase.rpc('open_cash_shift', {
    p_outlet_id: outletId, p_denominations: denominations, p_label: shiftLabel ?? null,
  });
  if (error) throw error;
  return data as ShiftRegister;
}

export async function closeShift({ registerId, denominations }: { registerId: string; denominations: CashDenominations }) {
  const unresolved = await getUnresolvedCount(registerId);
  if (unresolved > 0) throw new Error(`${unresolved} offline entries need syncing or review before closing.`);
  const { data, error } = await supabase.rpc('close_cash_shift', {
    p_register_id: registerId, p_denominations: denominations,
  });
  if (error) throw error;
  return data as ShiftRegister;
}
