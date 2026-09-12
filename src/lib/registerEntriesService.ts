import { supabase } from './supabaseClient';

export interface RegisterEntry {
  register_id: string;
  outlet_id: string;
  entry_type: 'bill' | 'payment' | 'expense' | 'deposit' | 'return' | 'credit_refund' | 'credit_received';
  amount: number;
  description: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
}

export async function getRegisterEntries(registerId: string): Promise<RegisterEntry[]> {
  const { data, error } = await supabase
    .from('register_entries')
    .select('*')
    .eq('register_id', registerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const { data: credits, error: creditError } = await supabase.from('credit_receipt_entries').select('*').eq('register_id', registerId);
  if (creditError) throw creditError;
  return [...(data as RegisterEntry[]), ...(credits ?? []).map((c) => ({ ...c, created_by_name: 'Staff member' } as RegisterEntry))].sort((a, b) => b.created_at.localeCompare(a.created_at));
}
