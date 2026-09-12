import { useEffect, useState } from 'react';
import { discardFailedAction, getFailedActions, getPendingCount } from '../lib/offlineQueue';
import type { QueuedAction } from '../lib/types';

export default function OfflineIndicator() {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState<QueuedAction[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);

    const interval = setInterval(() => {
      void getPendingCount().then(setPending);
      void getFailedActions().then(setFailed);
    }, 5000);

    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
      clearInterval(interval);
    };
  }, []);

  async function handleDiscard(local_id: string) {
    if (!window.confirm('Have you reviewed this failed entry with HQ? Discarding it will be logged.')) return;
    try { await discardFailedAction(local_id); setFailed(await getFailedActions()); }
    catch (e) { window.alert(e instanceof Error ? e.message : 'Reconnect to record this review before discarding.'); }
  }

  if (online && pending === 0 && failed.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 max-w-sm">
      {failed.length > 0 && (
        <div className="mb-2 bg-red-100 text-red-800 rounded-lg shadow text-sm">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full text-left px-4 py-2 font-medium"
          >
            {failed.length} entr{failed.length === 1 ? 'y' : 'ies'} could not be saved — tap for details
          </button>
          {expanded && (
            <div className="border-t border-red-200 px-4 py-2 space-y-2 max-h-64 overflow-y-auto">
              {failed.map((a) => (
                <div key={a.local_id} className="border-b border-red-200 pb-2 last:border-b-0">
                  <p className="font-medium">{a.table}</p>
                  <p className="text-xs">{a.error_message}</p>
                  <button
                    onClick={() => void handleDiscard(a.local_id)}
                    className="text-xs underline mt-1"
                  >
                    Discard (re-enter manually if needed)
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {(!online || pending > 0) && (
        <div
          className={`px-4 py-2 rounded-lg shadow text-sm font-medium ${
            online ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'
          }`}
        >
          {online
            ? `Syncing… ${pending} entr${pending === 1 ? 'y' : 'ies'} pending`
            : `Offline — ${pending} entr${pending === 1 ? 'y' : 'ies'} queued`}
        </div>
      )}
    </div>
  );
}
