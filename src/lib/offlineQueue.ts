import { supabase } from './supabaseClient';
import { businessDate } from './cashDenominations';
import type { QueuedAction } from './types';
const DB_NAME = 'cash_mgmt_offline', STORE_NAME = 'queued_actions';
const PERMANENT_CODES = new Set(['23505', '23514', '22P02', 'P0001', '42501']);
interface CashContext { actorId: string; outletId: string; registerId: string; }
let context: CashContext | null = null;
export function setCashContext(value: CashContext | null) { context = value; }
async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'local_id' }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function readActions(): Promise<QueuedAction[]> {
  const db = await openDb();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as QueuedAction[]); request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
async function save(action: QueuedAction, remove = false): Promise<void> {
  const db = await openDb();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    if (remove) tx.objectStore(STORE_NAME).delete(action.local_id); else tx.objectStore(STORE_NAME).put(action);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
function belongsToActor(action: QueuedAction) {
  const owner = action.actor_id ?? action.payload.created_by ?? action.payload.received_by ?? action.payload.deposited_by ?? action.payload.p_created_by;
  return !!context && owner === context.actorId;
}
export async function getPendingCount(): Promise<number> { return (await readActions()).filter((a) => belongsToActor(a) && !a.synced && !a.failed).length; }
export async function getUnresolvedCount(registerId: string): Promise<number> { return (await readActions()).filter((a) => belongsToActor(a) && !a.synced && (!a.register_id || a.register_id === registerId)).length; }
export async function getFailedActions(): Promise<QueuedAction[]> { return (await readActions()).filter((a) => belongsToActor(a) && a.failed); }
export async function discardFailedAction(id: string): Promise<void> {
  const action = (await readActions()).find((a) => a.local_id === id);
  if (!action || !action.failed || !belongsToActor(action)) throw new Error('Only your own failed entries can be discarded.');
  const { error } = await supabase.from('sync_failures').insert({ outlet_id: context!.outletId, device_id: action.device_id, table_name: action.table, error_message: `Reviewed and discarded: ${action.error_message}`, payload: action.payload });
  if (error) throw error;
  await save(action, true);
}
export async function queueAction(table: QueuedAction['table'], operation: QueuedAction['operation'], payload: Record<string, unknown>): Promise<string> {
  const current = context;
  const { data } = await supabase.auth.getSession();
  if (!current || data.session?.user.id !== current.actorId || payload.outlet_id !== current.outletId) throw new Error('Open your outlet shift before recording entries.');
  const id = crypto.randomUUID();
  let deviceId = localStorage.getItem('device_id');
  if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem('device_id', deviceId); }
  await save({ local_id: id, actor_id: current.actorId, register_id: current.registerId, table, operation,
    payload: { ...payload, register_date: payload.register_date ?? businessDate() }, created_offline_at: new Date().toISOString(), device_id: deviceId, synced: false });
  if (navigator.onLine) void syncPendingActions();
  return id;
}
export async function runCashAction(kind: QueuedAction['table'], payload: Record<string, unknown>, operationId = crypto.randomUUID()) {
  const current = context;
  if (!current) throw new Error('Open your outlet shift first.');
  const { data, error } = await supabase.rpc('submit_cash_action', { p_operation_id: operationId, p_kind: kind,
    p_payload: { ...payload, outlet_id: current.outletId }, p_register_id: current.registerId, p_actor_id: current.actorId });
  if (error) throw error;
  return data;
}
let syncing = false;
export async function syncPendingActions(): Promise<void> {
  if (syncing || !context) return;
  syncing = true;
  try {
    const run = async () => {
      // Failed diagnostics remain durable locally until the server accepts them.
      for (const failed of (await readActions()).filter((a) => belongsToActor(a) && a.failed && !a.failure_reported)) {
        const { error } = await supabase.from('sync_failures').insert({ id: failed.local_id, outlet_id: failed.payload.outlet_id ?? context!.outletId,
          device_id: failed.device_id, table_name: failed.table, error_message: failed.error_message, payload: failed.payload });
        if (!error || error.code === '23505') await save({ ...failed, failure_reported: true });
      }
      const actions = (await readActions()).filter((a) => belongsToActor(a) && !a.synced && !a.failed).sort((a, b) => a.created_offline_at.localeCompare(b.created_offline_at));
      for (const action of actions) {
        if (!belongsToActor(action)) break;
        if (!action.actor_id || !action.register_id || action.table === 'record_walk_in_sale') {
          await save({ ...action, failed: true, error_message: 'Older app entry: reconcile with HQ before re-entering. It has no verified original shift.' }); continue;
        }
        const { data: session } = await supabase.auth.getSession();
        if (session.session?.user.id !== action.actor_id) break;
        const { error } = await supabase.rpc('submit_cash_action', { p_operation_id: action.local_id, p_kind: action.table, p_payload: action.payload, p_register_id: action.register_id, p_actor_id: action.actor_id });
        if (error) {
          if (PERMANENT_CODES.has(error.code ?? '')) await save({ ...action, failed: true, error_message: error.message });
          break;
        }
        await save(action, true);
      }
    };
    if (navigator.locks) await navigator.locks.request('cash-mgmt-sync', run); else await run();
  } catch (error) { console.error('Cash sync will retry:', error); }
  finally { syncing = false; }
}
export function initOfflineSync(): () => void {
  const retry = () => { if (navigator.onLine) void syncPendingActions(); };
  window.addEventListener('online', retry);
  const interval = setInterval(retry, 30_000);
  return () => { window.removeEventListener('online', retry); clearInterval(interval); };
}
