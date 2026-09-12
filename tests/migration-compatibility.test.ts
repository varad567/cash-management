import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

it('revokes legacy RPC overloads and tolerates missing signatures', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create function public.use_customer_credit(uuid) returns void language sql as 'select';
      grant execute on function public.use_customer_credit(uuid) to authenticated;`);
    const migration = readFileSync('supabase/migrations/0028_cash_controls_and_counts.sql', 'utf8');
    const block = migration.match(/do \$legacy_rpc_revocations\$[\s\S]*?\$legacy_rpc_revocations\$;/)![0];
    await db.exec(block);
    const result = await db.query<{allowed: boolean}>(`select has_function_privilege('authenticated', 'public.use_customer_credit(uuid)', 'execute') as allowed`);
    expect(result.rows[0].allowed).toBe(false);
    await db.exec('drop function public.use_customer_credit(uuid)');
    await db.exec(block);
  } finally { await db.close(); }
}, 30000);
