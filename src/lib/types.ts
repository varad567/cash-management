import type { CashDenominations } from './cashDenominations';
export type UserRole = 'cashier' | 'manager' | 'audit' | 'hq';

export interface Outlet {
  id: string;
  name: string;
  address: string | null;
  is_active: boolean;
}

export interface AppUser {
  id: string;
  outlet_id: string | null;
  full_name: string;
  role: UserRole;
  is_active: boolean;
}

export type AdmissionStatus = 'admitted' | 'discharged';

export interface Admission {
  id: string;
  outlet_id: string;
  patient_name: string;
  ward_bed: string | null;
  referring_doctor: string | null;
  admitted_at: string;
  discharged_at: string | null;
  status: AdmissionStatus;
}

export type BillType = 'admitted_patient' | 'walk_in';
export type BillStatus = 'open' | 'partial' | 'paid' | 'cancelled';

export interface Bill {
  id: string;
  outlet_id: string;
  register_id: string | null;
  bill_serial: string;
  bill_type: BillType;
  admission_id: string | null;
  bill_amount: number;
  amount_paid: number;
  balance_due: number;
  status: BillStatus;
  register_date: string;
}

export type PaymentMode = 'cash' | 'online';

export interface Payment {
  id: string;
  bill_id: string;
  outlet_id: string;
  register_id: string | null;
  amount: number;
  mode: PaymentMode;
  gateway_reference: string | null;
  register_date: string;
  received_at: string;
}

export interface Expense {
  id: string;
  outlet_id: string;
  register_id: string | null;
  amount: number;
  reason: string;
  receipt_url: string | null;
  requires_hq_approval: boolean;
  approved_by: string | null;
  approved_at: string | null;
  register_date: string;
  created_by: string;
  created_at: string;
}

export interface SalesReturn {
  id: string;
  outlet_id: string;
  register_id: string | null;
  original_bill_id: string;
  amount_returned: number;
  reason: string;
  stock_reversed: boolean;
  approved_by: string;
  created_by: string;
  register_date: string;
  created_at: string;
}

export type RegisterStatus = 'open' | 'pending_sync' | 'closed' | 'flagged';

// One row per shift instance (not per day — outlets are 24/7 with a
// variable number of shifts/day). A new shift must chain to the most
// recently closed one via previous_register_id, and its
// opening_balance must equal that register's counted_closing —
// enforced server-side in migration 0006.
export interface ShiftRegister {
  id: string;
  outlet_id: string;
  register_date: string;
  shift_label: string | null;
  previous_register_id: string | null;
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
  status: RegisterStatus;
  opened_by: string | null;
  opened_at: string;
  closed_by: string | null;
  closed_at: string | null;
}

// --- Offline queue item ---
// Any create/update made while offline is stored here first,
// then replayed against Supabase once connectivity returns.
// 'table' doubles as the RPC function name when operation is 'rpc'
// (e.g. record_walk_in_sale) — see offlineQueue.ts.
export interface QueuedAction {
  local_id: string;
  actor_id?: string;
  register_id?: string;
  table:
    | 'bills'
    | 'payments'
    | 'expenses'
    | 'admissions'
    | 'cash_deposits'
    | 'returns'
    | 'customer_credits'
    | 'record_walk_in_sale'
    | 'sale'
    | 'credit_apply'
    | 'credit_refund';
  operation: 'insert' | 'update' | 'rpc';
  payload: Record<string, unknown>;
  created_offline_at: string; // actual event time — used for register_date, never sync time
  device_id: string;
  synced: boolean;
  // A permanent failure (duplicate bill number, a business rule
  // violation, etc.) is never retried once flagged — retrying can't
  // fix bad data, and retrying it forever forever hides the problem
  // from the person who could actually fix it. Distinct from a
  // network/RLS hiccup, which stays retryable.
  failed?: boolean;
  error_message?: string;
  failure_reported?: boolean;
}

export interface AlertRecipient {
  id: string;
  email: string;
  label: string | null;
  is_active: boolean;
  created_at: string;
}

export interface ShiftDispute {
  id: string;
  register_id: string;
  outlet_id: string;
  raised_by: string;
  claimed_counted_closing: number | null;
  reason: string;
  status: 'open' | 'reviewed' | 'resolved';
  hq_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}
