// Supabase Edge Function: send-alert
// ============================================================
// Called from Postgres triggers and the daily cron job via pg_net,
// never directly by the app or a browser. Auth is a shared secret
// header, not a user session, because the caller is the database.
//
// Event types:
//   'shift_closed'  — every close (migration 0023). Full receipt to
//                     alert_recipients + personal confirmation to the
//                     employee who closed it.
//   'sync_failure'  — permanent offline-sync failure (migration 0021).
//   'shift_dispute' — employee flagged a close within 24h (migration 0025).
//   'daily_digest'  — per-outlet daily rollup (migration 0026).
//
// Required secrets:
//   ALERT_SHARED_SECRET, RESEND_API_KEY, ALERT_FROM_EMAIL
//
// Deploy: supabase functions deploy send-alert --no-verify-jwt

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-alert-secret',
};

interface DigestShift {
  shift_label?: string | null;
  closed_at?: string;
  closed_by_name?: string;
  expected_closing?: number;
  counted_closing?: number;
  mismatch?: number;
}

interface AlertPayload {
  _notification_id?: string;
  failure_id?: string;
  total_credits_received?: number;
  credits_received?: number;
  type: 'shift_closed' | 'sync_failure' | 'shift_dispute' | 'daily_digest';
  outlet_id?: string | null;
  register_id?: string;
  shift_label?: string | null;
  opened_by?: string | null;
  closed_by?: string | null;
  opening_balance?: number;
  cash_sales?: number;
  cash_collected_old_bills?: number;
  online_received?: number;
  expenses_paid?: number;
  deposits_made?: number;
  cash_returned?: number;
  credits_refunded?: number;
  expected_closing?: number;
  counted_closing?: number;
  mismatch?: number;
  closed_at?: string;
  table_name?: string;
  error_message?: string;
  created_at?: string;
  // dispute
  raised_by?: string;
  claimed_counted_closing?: number | null;
  reason?: string;
  // digest
  digest_date?: string;
  shift_count?: number;
  total_cash_sales?: number;
  total_old_bills?: number;
  total_online?: number;
  total_expenses?: number;
  total_deposits?: number;
  total_returned?: number;
  total_credits_refunded?: number;
  net_mismatch?: number;
  gross_mismatch?: number;
  mismatch_count?: number;
  shifts?: DigestShift[];
}

function escapeHtml(s: string): string { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }

function money(n: number | undefined | null): string {
  return `₹${(n ?? 0).toFixed(2)}`;
}

function hasMismatch(m: number | undefined): boolean {
  return Math.abs(m ?? 0) > 0.005;
}

function row(label: string, value: string, bold = false): string {
  const w = bold ? 'font-weight:bold;' : '';
  return `<tr><td style="${w}">${label}</td><td style="text-align:right;${w}">${value}</td></tr>`;
}

function shiftBreakdownHtml(
  p: AlertPayload,
  outletName: string,
  openedByName: string,
  closedByName: string
): string {
  const banner = hasMismatch(p.mismatch)
    ? `<p style="color:#b91c1c;font-weight:bold;">⚠ Mismatch of ${money(Math.abs(p.mismatch ?? 0))} (${(p.mismatch ?? 0) > 0 ? 'over' : 'short'})</p>`
    : `<p style="color:#15803d;font-weight:bold;">✓ Matched, no discrepancy</p>`;

  return `
    <p><strong>Outlet:</strong> ${outletName}</p>
    ${p.shift_label ? `<p><strong>Shift:</strong> ${p.shift_label}</p>` : ''}
    <p><strong>Opened by:</strong> ${openedByName} &nbsp;|&nbsp; <strong>Closed by:</strong> ${closedByName}</p>
    <p><strong>Closed at:</strong> ${p.closed_at ?? ''}</p>
    ${banner}
    <table cellpadding="4" style="border-collapse:collapse;margin-top:8px;">
      ${row('Opening balance', money(p.opening_balance))}
      ${row('Cash sales', money(p.cash_sales))}
      ${row('Customer credits received', money(p.credits_received))}
      ${row('Cash collected (old bills)', money(p.cash_collected_old_bills))}
      ${row('Online received', money(p.online_received))}
      ${row('Expenses paid', `-${money(p.expenses_paid)}`)}
      ${row('Deposits made', `-${money(p.deposits_made)}`)}
      ${row('Cash returned', `-${money(p.cash_returned)}`)}
      ${row('Credits refunded', `-${money(p.credits_refunded)}`)}
      ${row('Expected closing', money(p.expected_closing), true)}
      ${row('Counted closing', money(p.counted_closing), true)}
    </table>
  `;
}

function digestHtml(p: AlertPayload, outletName: string): string {
  const shifts = p.shifts ?? [];
  const shiftRows = shifts
    .map((s) => {
      const mm = hasMismatch(s.mismatch)
        ? `<span style="color:#b91c1c;">${money(Math.abs(s.mismatch ?? 0))} ${(s.mismatch ?? 0) > 0 ? 'over' : 'short'}</span>`
        : `<span style="color:#15803d;">matched</span>`;
      const time = s.closed_at ? new Date(s.closed_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : '';
      return `<tr>
        <td>${s.shift_label ?? '—'}</td>
        <td>${s.closed_by_name ?? 'Unknown'}</td>
        <td style="text-align:right;">${time}</td>
        <td style="text-align:right;">${money(s.counted_closing)}</td>
        <td style="text-align:right;">${mm}</td>
      </tr>`;
    })
    .join('');

  const mismatchSummary =
    (p.mismatch_count ?? 0) > 0
      ? `<p style="color:#b91c1c;font-weight:bold;">${p.mismatch_count} of ${p.shift_count} shifts had a mismatch — ${money(p.gross_mismatch)} total across all discrepancies, net ${money(p.net_mismatch)}.</p>`
      : `<p style="color:#15803d;font-weight:bold;">✓ All ${p.shift_count} shifts matched.</p>`;

  return `
    <h2>Daily digest — ${outletName}</h2>
    <p><strong>Date:</strong> ${p.digest_date ?? ''}</p>
    ${mismatchSummary}
    <h3 style="margin-bottom:4px;">Day totals</h3>
    <table cellpadding="4" style="border-collapse:collapse;">
      ${row('Cash sales', money(p.total_cash_sales))}
      ${row('Customer credits received', money(p.total_credits_received))}
      ${row('Cash collected (old bills)', money(p.total_old_bills))}
      ${row('Online received', money(p.total_online))}
      ${row('Expenses paid', `-${money(p.total_expenses)}`)}
      ${row('Deposits made', `-${money(p.total_deposits)}`)}
      ${row('Cash returned', `-${money(p.total_returned)}`)}
      ${row('Credits refunded', `-${money(p.total_credits_refunded)}`)}
    </table>
    <h3 style="margin-bottom:4px;margin-top:16px;">Shifts (${p.shift_count})</h3>
    <table cellpadding="6" style="border-collapse:collapse;font-size:14px;">
      <tr style="background:#f1f5f9;">
        <th align="left">Shift</th><th align="left">Closed by</th>
        <th align="right">Time</th><th align="right">Counted</th><th align="right">Result</th>
      </tr>
      ${shiftRows}
    </table>
  `;
}

async function sendResendEmail(to: string, subject: string, html: string, idempotencyKey?: string): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY')!;
  const from = Deno.env.get('ALERT_FROM_EMAIL')!;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    throw new Error(`Email provider rejected delivery (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const secret = req.headers.get('x-alert-secret');
  if (!secret || secret !== Deno.env.get('ALERT_SHARED_SECRET')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let notificationId: string | undefined;
  try {
    const payload = (await req.json()) as AlertPayload;
    notificationId = payload._notification_id;
    for (const key of ['shift_label', 'reason', 'error_message', 'table_name', 'created_at', 'closed_at', 'digest_date'] as const) {
      if (typeof payload[key] === 'string') payload[key] = escapeHtml(payload[key]!);
    }
    payload.shifts = payload.shifts?.map((s) => ({ ...s, shift_label: s.shift_label ? escapeHtml(s.shift_label) : s.shift_label, closed_by_name: s.closed_by_name ? escapeHtml(s.closed_by_name) : s.closed_by_name }));
    if (!['shift_closed', 'sync_failure', 'shift_dispute', 'daily_digest'].includes(payload.type)) throw new Error('Unsupported notification type');

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Retry recipients independently. Provider idempotency also covers a lost success response.
    async function sendTracked(to: string, subject: string, html: string) {
      if (notificationId) {
        const { data, error } = await admin.from('notification_deliveries').select('recipient').eq('notification_id', notificationId).eq('recipient', to).maybeSingle();
        if (error) throw error;
        if (data) return;
      }
      await sendResendEmail(to, subject, html, notificationId ? `${notificationId}:${to}` : undefined);
      if (notificationId) {
        const { error } = await admin.from('notification_deliveries').upsert({ notification_id: notificationId, recipient: to }, { onConflict: 'notification_id,recipient' });
        if (error) throw error;
      }
    }
    async function acknowledge() {
      if (!notificationId) return;
      const { error } = await admin.from('notification_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null }).eq('id', notificationId);
      if (error) throw error;
    }

    let outletName = 'Unknown outlet';
    if (payload.outlet_id) {
      const { data: outlet } = await admin
        .from('outlets')
        .select('name')
        .eq('id', payload.outlet_id)
        .single();
      if (outlet) outletName = escapeHtml(outlet.name);
    }

    // Recipients are the same list for every owner-facing alert type.
    const { data: recipients, error: recipientError } = await admin
      .from('alert_recipients')
      .select('email')
      .eq('is_active', true);
    if (recipientError) throw recipientError;
    const ownerEmails = (recipients ?? []).map((r) => r.email as string);

    async function sendToOwners(subject: string, html: string): Promise<number> {
      if (ownerEmails.length === 0) throw new Error('No active alert recipients configured');
      await Promise.all(ownerEmails.map((e) => sendTracked(e, subject, html)));
      return ownerEmails.length;
    }

    // ---------- shift_closed ----------
    if (payload.type === 'shift_closed') {
      const ids = [payload.opened_by, payload.closed_by].filter(Boolean) as string[];
      const { data: users } = await admin
        .from('app_users')
        .select('id, full_name')
        .in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
      const nameById = new Map((users ?? []).map((u) => [u.id, escapeHtml(u.full_name as string)]));
      const openedByName = nameById.get(payload.opened_by ?? '') ?? 'Unknown';
      const closedByName = nameById.get(payload.closed_by ?? '') ?? 'Unknown';

      const breakdown = shiftBreakdownHtml(payload, outletName, openedByName, closedByName);
      const subject = hasMismatch(payload.mismatch)
        ? `Shift closed with mismatch — ${outletName}`
        : `Shift closed — ${outletName}`;

      const ownerSent = await sendToOwners(subject, `<h2>Shift close receipt</h2>${breakdown}`);

      let employeeSent = false;
      if (payload.closed_by) {
        const { data: closerAuth, error: closerError } = await admin.auth.admin.getUserById(payload.closed_by);
        if (closerError) throw closerError;
        if (closerAuth.user?.email) {
          await sendTracked(
            closerAuth.user.email,
            `Your shift close confirmation — ${outletName}`,
            `<h2>Here's what you submitted</h2>${breakdown}
             <p style="color:#64748b;font-size:13px;margin-top:16px;">
               If this doesn't match what you counted, open the app and raise a dispute
               from "My Shifts" within 24 hours of closing. After that the window closes
               and you'll need to contact HQ directly.
             </p>`
          );
          employeeSent = true;
        }
      }

      await acknowledge();
      return new Response(JSON.stringify({ owner_sent: ownerSent, employee_sent: employeeSent }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ---------- shift_dispute ----------
    if (payload.type === 'shift_dispute') {
      let raisedByName = 'Unknown';
      if (payload.raised_by) {
        const { data: u } = await admin
          .from('app_users')
          .select('full_name')
          .eq('id', payload.raised_by)
          .single();
        if (u) raisedByName = escapeHtml(u.full_name as string);
      }

      const { data: reg } = await admin
        .from('shift_registers')
        .select('shift_label, closed_at, expected_closing, counted_closing, mismatch')
        .eq('id', payload.register_id ?? '')
        .single();

      const html = `
        <h2 style="color:#b91c1c;">Shift close disputed</h2>
        <p><strong>Outlet:</strong> ${outletName}</p>
        <p><strong>Raised by:</strong> ${raisedByName}</p>
        <p><strong>Raised at:</strong> ${payload.created_at ?? ''}</p>
        ${reg?.shift_label ? `<p><strong>Shift:</strong> ${escapeHtml(reg.shift_label)}</p>` : ''}
        <p><strong>Originally closed at:</strong> ${reg?.closed_at ?? ''}</p>
        <table cellpadding="4" style="border-collapse:collapse;margin-top:8px;">
          ${row('As recorded — expected', money(reg?.expected_closing))}
          ${row('As recorded — counted', money(reg?.counted_closing))}
          ${row('As recorded — mismatch', money(reg?.mismatch))}
          ${payload.claimed_counted_closing != null ? row('Employee says they counted', money(payload.claimed_counted_closing), true) : ''}
        </table>
        <h3 style="margin-bottom:4px;margin-top:16px;">Their reason</h3>
        <p style="background:#f8fafc;padding:12px;border-left:3px solid #cbd5e1;">${payload.reason ?? ''}</p>
        <p style="color:#64748b;font-size:13px;margin-top:16px;">
          The closed register itself has not been altered — it stays as originally recorded.
          Review and resolve this from the Disputes screen in the app.
        </p>
      `;

      const sent = await sendToOwners(`Shift close disputed — ${outletName}`, html);
      await acknowledge();
      return new Response(JSON.stringify({ sent }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ---------- daily_digest ----------
    if (payload.type === 'daily_digest') {
      const subject =
        (payload.mismatch_count ?? 0) > 0
          ? `Daily digest — ${outletName} (${payload.mismatch_count} mismatch${(payload.mismatch_count ?? 0) === 1 ? '' : 'es'})`
          : `Daily digest — ${outletName}`;
      const sent = await sendToOwners(subject, digestHtml(payload, outletName));
      await acknowledge();
      return new Response(JSON.stringify({ sent }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ---------- sync_failure ----------
    const html = `
      <h2>Permanent sync failure logged</h2>
      <p><strong>Outlet:</strong> ${outletName}</p>
      <p><strong>Table:</strong> ${payload.table_name}</p>
      <p><strong>Error:</strong> ${payload.error_message}</p>
      <p><strong>Time:</strong> ${payload.created_at ?? ''}</p>
    `;
    const sent = await sendToOwners(`Sync failure at ${outletName}`, html);

    if (payload.failure_id) {
      const { error } = await admin.from('sync_failures').update({ notified: true }).eq('id', payload.failure_id);
      if (error) throw error;
    }

    await acknowledge();
    return new Response(JSON.stringify({ sent }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (notificationId) {
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      await admin.from('notification_outbox').update({ last_error: err instanceof Error ? err.message : 'Delivery failed' }).eq('id', notificationId);
    }
    console.error('send-alert error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
