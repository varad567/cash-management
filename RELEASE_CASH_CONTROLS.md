# Cash controls, denomination counts, split payments and bill CSV

This release starts from commit `64010ed7d26ca02fdd6204c678dd7108580bce49` and adds migrations **0027–0029**. It has not been deployed to production.

## User-facing changes

- Opening and closing require note/coin quantities and an explicit count confirmation. The server calculates totals. The first opening can have nonzero cash; subsequent openings must match the previous counted closing. Counts remain visible in Shift History. Existing shifts show that counts were not recorded.
- Walk-in bills support cash, online, or cash + online. Both payment portions and the bill save atomically. Online payments require a transaction reference. Admitted-patient bills also support split and partial payment.
- Bills has a date-range CSV export with one row per bill, bill number, outlet, bill amount, cash paid, online paid, credit applied, total paid, ledger payment total, balance, returns, ledger difference, status, references and stable IDs. It exports all matching rows, not the screen's 30-row preview. Dates select the bill's Indian register date; payments are lifetime collections as observed during export. This is a comparison file, not an integration with an unspecified billing-software import API. Use bill number + outlet to match; import bill numbers as text to preserve leading zeros.
- Returns are now requests. A signed-in manager/HQ user approves and confirms cash payout or rejects the request. Pending returns block shift closing. Cashiers can no longer select someone else's name as approval.
- Customer-credit receipts increase physical cash; using a credit settles a bill without receiving cash again. A held credit can be settled once. Refunds, deposits and closing use the same cash buckets.
- HQ can see pending/failed email deliveries and retry failed notifications from Alerts.

## Audit fixes

F01/F02: atomic server-calculated close with consistent outlet/register locks. F03: direct bill/payment/register mutations revoked. F04: server expense threshold, protected financial fields, active-HQ approval RPC. F05: real manager/HQ return approval. F06/F07/F10: correct credit receipt/settlement/refund buckets, audited single-use transitions, credit-payment uniqueness, corrected deposit cap. F08: no client audit inserts. F09: auditors cannot use cash write RPCs. F11: manager dispute reads are outlet-scoped. F12: digest execution restricted, anonymous diagnostic inserts denied. F13: operation ID and business write commit together, original actor/shift preserved. F14: durable outbox, provider rejection propagates, per-recipient success deduplication. F15: current active status checked by account-management functions and administrative RLS.

No historical financial numbers are automatically rewritten. Legacy held credits have `receipt_recorded=false`; their physical cash should already be included in the verified opening drawer. Review those liabilities before rollout. Old paid-bill discrepancies are exposed by CSV `ledger_difference`.

## Validation

Local results on 12 September 2026: **55 unit/database tests passed, 4 browser tests passed**, production build and Edge TypeScript checks passed, lint completed with warnings and no errors, and `git diff --check` passed. The Windows sandbox required manually stopping the test-owned Vite process after the browser assertions passed; the test runner then exited successfully. The deposit screen now shares the closing formula, including both credit receipts and refunds.

Run `npm ci`, `npm test`, `npm run check:edge`, `npm run build`, `npm run lint`, and `npm run test:e2e`.

- Unit/database tests use PGlite, all migrations in order, real RLS and trigger/function SQL, synthetic users/outlets, and stubs for Supabase Auth, Storage, pg_net and pg_cron.
- Browser tests use an isolated headless Edge profile and mocked Supabase responses. They exercise denomination entry/handover validation, closing request contents, atomic split-payment submission and actual CSV downloading.
- Edge handler tests mock auth/database/provider calls and demonstrate provider-429 retry recovery and inactive-HQ rejection. No emails, accounts or production cash transactions are created.
- `tsconfig.edge.json` checks the Edge Function TypeScript using a minimal Deno host declaration and the installed Supabase types. It is not a hosted Deno deployment smoke test.
- Real multi-connection PostgreSQL concurrency, deployed grants/hooks, actual email acceptance, and the production schema have not been tested. Those are staging/release checks, not implied by local test success.

## Deployment order

1. Compare the deployed schema and function definitions with the repository. Run the read-only `scripts/preflight_cash_controls.sql` against the intended project and review every discrepancy. Take and verify a restorable database backup.
2. Test this release on a separate Supabase project restored from a suitable sanitized copy. Confirm ordinary cash operations, manager/HQ approval, storage access, actor isolation, repeated request IDs, and two-connection payment/close and credit-use races.
3. Before production maintenance, synchronize/review every device's queue, close open shifts with the existing app, record verified drawer counts and list outstanding customer credits. Browser-local queues on disconnected devices are not discoverable by the server. Do not erase them.
4. Apply **0027** and commit it. PostgreSQL must commit the new `credit` enum value before **0028** uses it. Then apply **0028** and **0029** in order, each in a transaction. If using SQL Editor, run the files separately. Do not paste all three into one transaction.
5. Deploy the canonical functions under `supabase/functions/`: `create-user`, `reset-user-password`, and `send-alert`. The alert function still requires `--no-verify-jwt`, authenticates with the existing shared-secret header, and uses the existing Resend secrets. Verify the service role has access to the new outbox/delivery tables.
6. Deploy the matching frontend and have all devices reload the updated app/service worker. The old frontend is incompatible with the newly revoked direct-write permissions. Keep cash entry paused during this coordinated switch.
7. Verify a denomination opening; a cash-only, online-only and split sale; a credit receipt and settlement/refund; an expense; an approved return; a deposit; a counted close; a matching CSV; and a delivered notification. Verify the cron jobs and that outbox entries transition from pending to sent.

## Recovery and historical reconciliation

Do not roll back to the old frontend alone: its writes are intentionally blocked. If rollout fails before cash entry resumes, restore the verified pre-release backup and matching old application together under the maintenance plan. If new transactions have already occurred, preserve them and fix forward; do not blindly restore an older database or subtract totals manually.

An old offline action with no verified actor/shift is quarantined for HQ review instead of silently assigned to a newer shift. A new action for a closed original shift is rejected and retained locally. Already-committed operation IDs can be acknowledged after close without double posting. A failed item must be reviewed and logged online before local discard. Closing checks unresolved entries for the current cashier/device; operational handover must also cover other devices/users.

CSV pagination has a bill-creation cutoff and stable IDs, but payment totals may change while a large export is running. Export after synchronization during a quiet period for an accounting comparison. No patient names are included.
