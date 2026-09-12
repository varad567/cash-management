import { queueAction } from './offlineQueue';
import { supabase } from './supabaseClient';
import { businessDate } from './cashDenominations';
import { compressImage } from './imageUtils';
import type { Expense } from './types';

const RECEIPT_BUCKET = 'expense-receipts';

// Uploads the receipt first (needs connectivity) and returns its path.
// Receipts aren't queued offline — a photo can't sensibly be replayed
// through IndexedDB — so this step requires the device to be online.
// Compressed client-side first — phone camera photos are routinely
// several MB, and a receipt only needs to be legible.
export async function uploadReceipt(outletId: string, file: File): Promise<string> {
  const compressed = await compressImage(file);
  const ext = compressed.name.split('.').pop() ?? 'jpg';
  const path = `${outletId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, compressed);
  if (error) throw error;
  return path;
}

// Bucket is private (see migration 0015) — a public URL wouldn't
// resolve. Signed URLs expire (1 hour here) rather than being a
// permanent link, since these are financial documents.
export async function getReceiptSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

interface CreateExpenseParams {
  outletId: string;
  amount: number;
  reason: string;
  receiptPath: string; // mandatory — enforced in the UI, not the DB (receipt_url is nullable at the schema level for backfilled/legacy rows)
  requiresHqApproval: boolean;
  createdBy: string;
}

export async function createExpense(params: CreateExpenseParams) {
  if (!params.receiptPath) {
    throw new Error('A receipt is required for every expense entry');
  }
  return queueAction('expenses', 'insert', {
    outlet_id: params.outletId,
    amount: params.amount,
    reason: params.reason,
    receipt_url: params.receiptPath,
    requires_hq_approval: params.requiresHqApproval,
    register_date: businessDate(),
    created_by: params.createdBy,
  });
}

export async function getRecentExpenses(outletId: string, limit = 20): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('outlet_id', outletId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as Expense[];
}

export interface ExpenseReadable extends Expense {
  outlet_name: string;
  created_by_name: string;
  approved_by_name: string | null;
}

// Cross-outlet — RLS on `expenses` already scopes this per caller
// (own outlet only for cashier/manager, all outlets for HQ/audit).
export async function getExpensesForApproval(limit = 50): Promise<ExpenseReadable[]> {
  const { data, error } = await supabase
    .from('expenses_readable')
    .select('*')
    .eq('requires_hq_approval', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as ExpenseReadable[];
}

// Direct, awaited call rather than offline-queued — approval is a
// deliberate HQ action, not a high-frequency counter transaction, and
// a rejection (e.g. the server-side role check) should surface right
// away. The DB trigger independently re-verifies the approver's role
// regardless of what the client believes.
export async function approveExpense(expenseId: string) {
  const { error } = await supabase.rpc('approve_cash_expense', { p_expense_id: expenseId });
  if (error) throw error;
}
