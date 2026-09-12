import type { ShiftRegister } from './types';

type RegisterTotals = Pick<
  ShiftRegister,
  | 'opening_balance'
  | 'cash_sales'
  | 'cash_collected_old_bills'
  | 'expenses_paid'
  | 'deposits_made'
  | 'cash_returned'
  | 'credits_refunded'
> & { credits_received?: number };

// The core reconciliation formula. Previously duplicated three times
// (shiftService.closeShift, ShiftClose.tsx, Dashboard.tsx) — any
// future change to it (e.g. adding a new deduction bucket) had to be
// remembered in three places at once. One shared, tested function now.
export function computeExpectedClosing(r: RegisterTotals): number {
  return (
    r.opening_balance +
    (r.credits_received ?? 0) +
    r.cash_sales +
    r.cash_collected_old_bills -
    r.expenses_paid -
    r.deposits_made -
    r.cash_returned -
    r.credits_refunded
  );
}
