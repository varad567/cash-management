export const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5] as const;
export type CashDenominations = Record<string, number>;

export function denominationTotal(counts: CashDenominations): number {
  let paise = 0;
  for (const [denomination, count] of Object.entries(counts)) {
    if (!DENOMINATIONS.some((d) => String(d) === denomination) || !Number.isSafeInteger(count) || count < 0 || count > 1_000_000) {
      throw new Error('Enter whole, non-negative quantities for each denomination.');
    }
    paise += Math.round(Number(denomination) * 100) * count;
  }
  return paise / 100;
}

export function businessDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map((type) => parts.find((p) => p.type === type)!.value).join('-');
}

export function toPaise(amount: number): number {
  const rounded = Math.round(amount * 100);
  if (!Number.isFinite(amount) || amount < 0 || amount > 9_999_999_999.99 || Math.abs(amount * 100 - rounded) > 0.0001) {
    throw new Error('Enter an amount with at most two decimal places.');
  }
  return rounded;
}

export function validateSplit(bill: number, cash: number, online: number, walkIn: boolean, reference: string): void {
  const total = toPaise(bill), paid = toPaise(cash) + toPaise(online);
  if (total <= 0 || (walkIn && paid !== total) || paid > total) throw new Error('Cash plus online must equal the walk-in bill total and cannot exceed the bill amount.');
  if (online > 0 && !reference.trim()) throw new Error('Enter the reference for the online payment.');
}
