import { describe, it, expect } from 'vitest';
import { computeExpectedClosing } from './registerMath';

const base = {
  opening_balance: 0,
  cash_sales: 0,
  cash_collected_old_bills: 0,
  expenses_paid: 0,
  deposits_made: 0,
  cash_returned: 0,
  credits_refunded: 0,
};

describe('computeExpectedClosing', () => {
  it('includes credit receipts and subtracts refunds from available drawer cash', () => {
    expect(computeExpectedClosing({
      ...base, opening_balance: 1000, credits_received: 400, credits_refunded: 150,
    })).toBe(1250);
  });
  it('returns just the opening balance when nothing else happened', () => {
    expect(computeExpectedClosing({ ...base, opening_balance: 500 })).toBe(500);
  });

  it('adds cash sales and old-bill collections', () => {
    expect(
      computeExpectedClosing({
        ...base,
        opening_balance: 1000,
        cash_sales: 2000,
        cash_collected_old_bills: 300,
      })
    ).toBe(3300);
  });

  it('subtracts expenses, deposits, and returns', () => {
    expect(
      computeExpectedClosing({
        ...base,
        opening_balance: 1000,
        cash_sales: 2000,
        expenses_paid: 200,
        deposits_made: 500,
        cash_returned: 100,
      })
    ).toBe(2200);
  });

  it('subtracts credit refunds too — the previously-missing bucket', () => {
    expect(
      computeExpectedClosing({
        ...base,
        opening_balance: 1000,
        cash_sales: 500,
        credits_refunded: 150,
      })
    ).toBe(1350);
  });

  it('never includes online payments in the cash figure', () => {
    // online_received deliberately isn't a parameter of this function
    // at all — it's not physical cash in the drawer, so it must never
    // silently leak into the expected-closing math.
    expect(computeExpectedClosing({ ...base, opening_balance: 1000, cash_sales: 500 })).toBe(1500);
  });

  it('can go negative if returns/expenses/deposits/refunds exceed cash in', () => {
    expect(computeExpectedClosing({ ...base, cash_sales: 100, cash_returned: 150 })).toBe(-50);
  });
});
