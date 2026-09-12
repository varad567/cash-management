import { useState } from 'react';
import { createReturn, findBillBySerial, getReturnedSoFar } from '../lib/returnsService';
import ReturnApprovals from '../components/ReturnApprovals';
import { useAuth } from '../lib/AuthContext';
import type { Bill } from '../lib/types';

export default function Returns() {
  const { appUser } = useAuth();
  const [billSerial, setBillSerial] = useState('');
  const [bill, setBill] = useState<Bill | null>(null);
  const [returnedSoFar, setReturnedSoFar] = useState(0);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [stockReversed, setStockReversed] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const remaining = bill ? bill.amount_paid - returnedSoFar : 0;
  const overLimit = amount !== '' && Number(amount) > remaining;
  const notPositive = amount !== '' && Number(amount) <= 0;

  async function handleLookup() {
    if (!appUser?.outlet_id || !billSerial) return;
    setError(null);
    const found = await findBillBySerial(appUser.outlet_id, billSerial.trim());
    if (!found) {
      setError('No bill found with that serial at this outlet');
      setBill(null);
      return;
    }
    setBill(found);
    setReturnedSoFar(await getReturnedSoFar(found.id));
  }

  async function handleSubmit() {
    if (!appUser?.outlet_id || !bill || !amount || !reason) return;
    if (notPositive) {
      setError('Return amount must be greater than zero');
      return;
    }
    if (overLimit) {
      setError(`Amount exceeds what's left to return on this bill (₹${remaining.toFixed(2)})`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createReturn({
        outletId: appUser.outlet_id,
        originalBillId: bill.id,
        amountReturned: Number(amount),
        reason,
        stockReversed,
        createdBy: appUser.id,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record return');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto mt-12 bg-white rounded-xl shadow p-8 text-center">
        <h2 className="text-xl font-semibold text-green-700 mb-2">Return request saved</h2>
        <p className="text-slate-500 mb-6">After sync, a manager or HQ must approve this request. Do not pay out the refund until approved.</p>
        <button
          onClick={() => {
            setDone(false);
            setBillSerial('');
            setBill(null);
            setAmount('');
            setReason('');
          }}
          className="bg-slate-800 text-white rounded-lg py-3 px-6 font-medium"
        >
          Log Another Return
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto bg-white rounded-xl shadow p-6">
      <ReturnApprovals />
      <h2 className="text-lg font-semibold text-slate-800 mb-4 mt-6">Sales Return</h2>

      <label className="block text-sm font-medium text-slate-700 mb-1">Original bill serial</label>
      <div className="flex gap-2 mb-4">
        <input
          className="flex-1 border border-slate-300 rounded-lg px-4 py-3"
          value={billSerial}
          onChange={(e) => setBillSerial(e.target.value)}
        />
        <button onClick={() => void handleLookup()} className="border border-slate-300 rounded-lg px-4">
          Find
        </button>
      </div>

      {bill && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4 text-sm">
          <p>Bill amount: ₹{bill.bill_amount.toFixed(2)}</p>
          <p>Paid so far: ₹{bill.amount_paid.toFixed(2)}</p>
          {returnedSoFar > 0 && <p>Already returned: ₹{returnedSoFar.toFixed(2)}</p>}
          <p className="font-medium mt-1">Available to return: ₹{remaining.toFixed(2)}</p>
        </div>
      )}

      {bill && (
        <>
          <label className="block text-sm font-medium text-slate-700 mb-1">Amount to return</label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            max={remaining}
            className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {notPositive && (
            <p className="text-sm text-red-600 mb-3">Amount must be greater than zero.</p>
          )}
          {overLimit && (
            <p className="text-sm text-red-600 mb-3">
              Can't return more than ₹{remaining.toFixed(2)} on this bill.
            </p>
          )}
          <div className="mb-4" />

          <label className="block text-sm font-medium text-slate-700 mb-1">Reason</label>
          <input
            className="w-full border border-slate-300 rounded-lg px-4 py-3 mb-4"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />

          <label className="flex items-center gap-2 mb-4 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={stockReversed}
              onChange={(e) => setStockReversed(e.target.checked)}
            />
            Stock has been put back
          </label>

          <p className="text-sm text-amber-800 mb-4">Submit for manager/HQ approval. Cash is deducted only when they approve and confirm the refund from their own account.</p>

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

          <button
            disabled={!amount || !reason || overLimit || notPositive || submitting}
            onClick={() => void handleSubmit()}
            className="w-full bg-slate-800 text-white font-medium rounded-lg py-3 disabled:opacity-40"
          >
            {submitting ? 'Saving…' : 'Request Return'}
          </button>
        </>
      )}
      {!bill && error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
