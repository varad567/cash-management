import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
interface PendingReturn { id: string; amount_returned: number; reason: string; original_bill_id: string; bills: { bill_serial: string } | null; outlets: { name: string } | null; }
export default function ReturnApprovals() {
  const { appUser } = useAuth();
  const [items, setItems] = useState<PendingReturn[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const canApprove = appUser?.role === 'hq' || appUser?.role === 'manager';
  async function refresh() {
    const { data, error } = await supabase.from('return_requests').select('id,amount_returned,reason,original_bill_id,bills(bill_serial),outlets(name)').eq('status', 'pending').order('created_at');
    if (error) throw error;
    setItems((data ?? []) as unknown as PendingReturn[]);
  }
  useEffect(() => { void refresh().catch((e) => setError(e.message)); }, []);
  async function review(id: string, approve: boolean) {
    if (approve && !window.confirm('Approve and record this cash refund now? Confirm the cash is being paid out.')) return;
    setBusy(id); setError('');
    try { const { error } = await supabase.rpc('review_cash_return', { p_request_id: id, p_approve: approve }); if (error) throw error; await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not review return'); } finally { setBusy(''); }
  }
  return <section className="mb-4 space-y-3"><div className="flex justify-between"><h2 className="font-semibold">Pending return requests</h2><button className="underline text-sm" onClick={() => void refresh().catch((e) => setError(e.message))}>Refresh</button></div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {!items.length && <p className="text-sm text-slate-500">No pending requests.</p>}
    {items.map((r) => <div key={r.id} className="border rounded-lg p-3 space-y-2"><p>{r.outlets?.name} · Bill {r.bills?.bill_serial ?? r.original_bill_id} · ₹{Number(r.amount_returned).toFixed(2)}</p><p className="text-sm">{r.reason}</p>
      {canApprove ? <div className="flex gap-4"><button disabled={!!busy} className="text-green-700 underline" onClick={() => void review(r.id, true)}>Approve cash refund</button><button disabled={!!busy} className="text-red-700 underline" onClick={() => void review(r.id, false)}>Reject</button></div> : <p className="text-xs text-amber-800">Awaiting manager/HQ approval.</p>}
    </div>)}
  </section>;
}
