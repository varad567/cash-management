import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
export const ids = {
  cashier: '10000000-0000-0000-0000-000000000001', manager: '10000000-0000-0000-0000-000000000002',
  hq: '10000000-0000-0000-0000-000000000003', audit: '10000000-0000-0000-0000-000000000004',
  other: '10000000-0000-0000-0000-000000000005', outlet: '20000000-0000-0000-0000-000000000001',
  outlet2: '20000000-0000-0000-0000-000000000002', admission: '50000000-0000-0000-0000-000000000001',
};
export async function createDatabase(options: { skipCreditSetup?: boolean } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role supabase_auth_admin; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    grant usage on schema auth to public; grant execute on all functions in schema auth to public;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean);
    create table storage.objects(id uuid,name text,bucket_id text); alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    create schema net; create table net.requests(body jsonb);
    create function net.http_post(url text,headers jsonb,body jsonb) returns bigint language plpgsql as $$begin insert into net.requests values(body);return 1;end$$;
    create schema cron;create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
  `);
  const path = resolve('supabase/migrations');
  for (const file of readdirSync(path).filter((f) => f.endsWith('.sql')).sort()) {
    if (options.skipCreditSetup && file === '0019_customer_credits.sql') continue;
    const sql = readFileSync(resolve(path,file),'utf8').replace(/create extension if not exists (?:"pgcrypto"|pg_net|pg_cron);/gi,'');
    try { await db.exec(sql); } catch (e) { throw new Error(`Migration ${file}: ${(e as Error).message}`); }
  }
  await db.exec(`
    insert into auth.users values('${ids.cashier}'),('${ids.manager}'),('${ids.hq}'),('${ids.audit}'),('${ids.other}');
    insert into outlets(id,name) values('${ids.outlet}','Test A'),('${ids.outlet2}','Test B');
    insert into app_users(id,outlet_id,full_name,role) values
      ('${ids.cashier}','${ids.outlet}','Cashier','cashier'),('${ids.manager}','${ids.outlet}','Manager','manager'),
      ('${ids.hq}',null,'HQ','hq'),('${ids.audit}',null,'Auditor','audit'),('${ids.other}','${ids.outlet2}','Other manager','manager');
  `);
  return db;
}
export async function asUser(db: PGlite,user: string = ids.cashier,role = 'cashier',outlet: string | null = ids.outlet) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)`,[user,JSON.stringify({ app_role: role, app_outlet_id: outlet })]);
  await db.exec('set role authenticated');
}
export async function action(db: PGlite, registerId: string, kind: string, payload: Record<string, unknown>, op=crypto.randomUUID(), actor: string=ids.cashier) {
  return (await db.query<{ result: {id: string} }>('select submit_cash_action($1,$2,$3::jsonb,$4,$5) as result',[op,kind,JSON.stringify({outlet_id:ids.outlet,...payload}),registerId,actor])).rows[0].result;
}
