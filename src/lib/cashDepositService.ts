import { businessDate } from './cashDenominations';
import { queueAction } from './offlineQueue';
import { supabase } from './supabaseClient';

export interface CashDeposit {
  id: string;
  outlet_id: string;
  register_id: string | null;
  amount: number;
  bank_reference: string | null;
  deposited_by: string;
  register_date: string;
  created_at: string;
}

interface CreateDepositParams {
  outletId: string;
  amount: number;
  bankReference?: string;
  depositedBy: string;
}

export async function createDeposit(params: CreateDepositParams) {
  return queueAction('cash_deposits', 'insert', {
    outlet_id: params.outletId,
    amount: params.amount,
    bank_reference: params.bankReference ?? null,
    deposited_by: params.depositedBy,
    register_date: businessDate(),
  });
}

export async function getRecentDeposits(outletId: string, limit = 20): Promise<CashDeposit[]> {
  const { data, error } = await supabase
    .from('cash_deposits')
    .select('*')
    .eq('outlet_id', outletId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as CashDeposit[];
}
