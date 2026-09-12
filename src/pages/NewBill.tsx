import { useEffect, useState } from 'react';
import { createSale } from '../lib/billService';
import { getActiveAdmissions } from '../lib/admissionService';
import { validateSplit } from '../lib/cashDenominations';
import { useAuth } from '../lib/AuthContext';
import type { Admission, BillType } from '../lib/types';
export default function NewBill() {
  const { appUser } = useAuth();
  const [billType, setBillType] = useState<BillType>('walk_in');
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [admissionId, setAdmissionId] = useState('');
  const [serial, setSerial] = useState('');
  const [amount, setAmount] = useState('');
  const [cash, setCash] = useState('');
  const [online, setOnline] = useState('');
  const [reference, setReference] = useState('');
  const [method, setMethod] = useState<'cash' | 'online' | 'split'>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (billType === 'admitted_patient' && appUser?.outlet_id) void getActiveAdmissions(appUser.outlet_id).then(setAdmissions).catch((e) => setError(e.message));
  }, [billType, appUser?.outlet_id]);
  const isWalkIn = billType === 'walk_in';
  const cashAmount = method === 'online' ? 0 : Number(isWalkIn && method === 'cash' ? amount : cash || 0);
  const onlineAmount = method === 'cash' ? 0 : Number(isWalkIn && method === 'online' ? amount : online || 0);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!appUser?.outlet_id) return;
    setError(''); setBusy(true);
    try {
      validateSplit(Number(amount), cashAmount, onlineAmount, isWalkIn, reference);
      if (!serial.trim() || (!isWalkIn && !admissionId)) throw new Error('Enter a bill number and select the admission if applicable.');
      await createSale({ outletId: appUser.outlet_id, billSerial: serial, billType, admissionId: isWalkIn ? null : admissionId,
        billAmount: Number(amount), cashAmount, onlineAmount, gatewayReference: reference });
      setDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save bill'); } finally { setBusy(false); }
  }
  const input = 'w-full border border-slate-300 rounded-lg px-3 py-3';
  if (done) return <div className="max-w-lg mx-auto bg-white p-6 rounded-xl space-y-4"><h2 className="text-xl font-semibold">Bill saved on this device</h2><p>Bill {serial} is queued for sync. Check the sync indicator for confirmation or errors before closing.</p><button className="underline" onClick={() => { setDone(false); setSerial(''); setAmount(''); setCash(''); setOnline(''); setReference(''); }}>Record another bill</button></div>;
  return <form onSubmit={(e) => void submit(e)} className="max-w-lg mx-auto bg-white p-6 rounded-xl shadow space-y-4">
    <h1 className="text-xl font-semibold">Record Bill</h1>
    <label className="block">Bill type<select className={input} value={billType} onChange={(e) => setBillType(e.target.value as BillType)}><option value="walk_in">Walk-in</option><option value="admitted_patient">Admitted patient</option></select></label>
    {!isWalkIn && <label className="block">Admission<select required className={input} value={admissionId} onChange={(e) => setAdmissionId(e.target.value)}><option value="">Select admission</option>{admissions.map((a) => <option key={a.id} value={a.id}>{a.patient_name} {a.ward_bed}</option>)}</select></label>}
    <label className="block">Bill number from billing software<input required className={input} value={serial} onChange={(e) => setSerial(e.target.value)} /></label>
    <label className="block">Bill amount (₹)<input required type="number" min="0.01" step="0.01" className={input} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
    <label className="block">Payment method<select className={input} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}><option value="cash">Cash</option><option value="online">Online</option><option value="split">Cash + online</option></select></label>
    {(method === 'split' || (!isWalkIn && method === 'cash')) && <label className="block">Cash received (₹)<input type="number" min="0" step="0.01" className={input} value={cash} onChange={(e) => setCash(e.target.value)} /></label>}
    {(method === 'split' || (!isWalkIn && method === 'online')) && <label className="block">Online received (₹)<input type="number" min="0" step="0.01" className={input} value={online} onChange={(e) => setOnline(e.target.value)} /></label>}
    {method !== 'cash' && <label className="block">Online transaction reference<input required={onlineAmount > 0} className={input} value={reference} onChange={(e) => setReference(e.target.value)} /></label>}
    <div className="bg-slate-50 p-3 rounded text-sm">Cash ₹{cashAmount.toFixed(2)} + online ₹{onlineAmount.toFixed(2)} = ₹{(cashAmount + onlineAmount).toFixed(2)}<br />{isWalkIn ? 'The combined payment must equal the full bill amount.' : `Remaining balance: ₹${(Number(amount || 0) - cashAmount - onlineAmount).toFixed(2)}`}</div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <button disabled={busy} className="w-full bg-slate-800 text-white py-3 rounded-lg disabled:opacity-40">{busy ? 'Saving…' : 'Save bill and payment'}</button>
  </form>;
}
