import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
interface Notification { id: string; status: string; attempts: number; created_at: string; last_error: string | null; }
export default function NotificationStatus() {
  const [items, setItems] = useState<Notification[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const { data, error } = await supabase.from('notification_outbox').select('id,status,attempts,created_at,last_error').neq('status', 'sent').order('created_at', { ascending: false }).limit(20);
    if (error) throw error;
    setItems((data ?? []) as Notification[]);
  }
  useEffect(() => { void refresh().catch((e) => setError(e.message)); }, []);
  async function retry(id: string) {
    setBusy(true); setError('');
    try { const { error } = await supabase.rpc('retry_cash_notification', { p_id: id }); if (error) throw error; await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not retry notification'); } finally { setBusy(false); }
  }
  return <section className="mt-6 bg-white rounded-lg p-4 space-y-3"><div className="flex justify-between"><h2 className="font-semibold">Email delivery</h2><button className="underline text-sm" onClick={() => void refresh().catch((e) => setError(e.message))}>Refresh</button></div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {!items.length && <p className="text-sm text-slate-500">No pending or failed notifications.</p>}
    {items.map((n) => <div key={n.id} className="border-t pt-2 text-sm"><p>{n.status} · {n.attempts} attempts · {new Date(n.created_at).toLocaleString()}</p>{n.last_error && <p className="text-red-700">{n.last_error}</p>}{n.status === 'failed' && <button disabled={busy} className="underline" onClick={() => void retry(n.id)}>Retry delivery</button>}</div>)}
  </section>;
}
