import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { AlertRecipient } from '../lib/types';
import NotificationStatus from '../components/NotificationStatus';

export default function AlertRecipients() {
  const [recipients, setRecipients] = useState<AlertRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addingNew, setAddingNew] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editLabel, setEditLabel] = useState('');

  async function load() {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('alert_recipients')
      .select('*')
      .order('created_at');
    if (fetchError) setError(fetchError.message);
    else setRecipients((data as AlertRecipient[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createRecipient() {
    if (!newEmail.trim()) return;
    setSubmitting(true);
    setError(null);
    const { error: insertError } = await supabase
      .from('alert_recipients')
      .insert({ email: newEmail.trim(), label: newLabel.trim() || null });
    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setNewEmail('');
    setNewLabel('');
    setAddingNew(false);
    void load();
  }

  function startEdit(r: AlertRecipient) {
    setEditingId(r.id);
    setEditEmail(r.email);
    setEditLabel(r.label ?? '');
  }

  async function saveEdit(id: string) {
    setSubmitting(true);
    setError(null);
    const { error: updateError } = await supabase
      .from('alert_recipients')
      .update({ email: editEmail.trim(), label: editLabel.trim() || null })
      .eq('id', id);
    setSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setEditingId(null);
    void load();
  }

  async function toggleActive(r: AlertRecipient) {
    setError(null);
    const { error: updateError } = await supabase
      .from('alert_recipients')
      .update({ is_active: !r.is_active })
      .eq('id', r.id);
    if (updateError) setError(updateError.message);
    else void load();
  }

  const activeCount = recipients.filter((r) => r.is_active).length;

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto p-4">
      <NotificationStatus />
      <div className="flex justify-between items-center mb-1">
        <h2 className="text-lg font-semibold text-slate-800">Alert Recipients</h2>
        <button
          onClick={() => setAddingNew(!addingNew)}
          className="text-sm bg-slate-800 text-white rounded-lg px-4 py-2 font-medium"
        >
          {addingNew ? 'Cancel' : '+ Add'}
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        These addresses receive shift-close receipts, mismatch alerts, sync failures, disputes, and
        the daily digest.
      </p>

      {activeCount === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-900">
          No active recipients — nobody is currently receiving any alerts.
        </div>
      )}

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {addingNew && (
        <div className="bg-white rounded-xl shadow p-4 mb-4 space-y-3">
          <input
            type="email"
            className="w-full border border-slate-300 rounded-lg px-4 py-3"
            placeholder="email@example.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <input
            className="w-full border border-slate-300 rounded-lg px-4 py-3"
            placeholder="Label (e.g. Owner, Audit lead) — optional"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
          />
          <button
            disabled={!newEmail.trim() || submitting}
            onClick={() => void createRecipient()}
            className="w-full bg-slate-800 text-white font-medium rounded-lg py-3 disabled:opacity-40"
          >
            {submitting ? 'Adding…' : 'Add Recipient'}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {recipients.map((r) => (
          <div key={r.id} className="bg-white rounded-xl shadow p-4">
            {editingId === r.id ? (
              <div className="space-y-3">
                <input
                  type="email"
                  className="w-full border border-slate-300 rounded-lg px-4 py-2"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                />
                <input
                  className="w-full border border-slate-300 rounded-lg px-4 py-2"
                  placeholder="Label"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    disabled={submitting || !editEmail.trim()}
                    onClick={() => void saveEdit(r.id)}
                    className="flex-1 bg-slate-800 text-white rounded-lg py-2 font-medium disabled:opacity-40"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="flex-1 border border-slate-300 rounded-lg py-2 font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800 truncate">
                    {r.email}{' '}
                    {!r.is_active && (
                      <span className="text-xs text-red-600 font-normal">(inactive)</span>
                    )}
                  </p>
                  {r.label && <p className="text-sm text-slate-500">{r.label}</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => startEdit(r)} className="text-sm text-slate-600 underline">
                    Edit
                  </button>
                  <button
                    onClick={() => void toggleActive(r)}
                    className={`text-sm underline ${r.is_active ? 'text-red-600' : 'text-green-700'}`}
                  >
                    {r.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {recipients.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-6">No recipients yet.</p>
        )}
      </div>
    </div>
  );
}
