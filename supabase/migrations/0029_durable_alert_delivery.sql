-- Outbound requests are retried until the Edge Function confirms provider acceptance.
drop policy if exists sync_failures_insert_own_outlet on sync_failures;
create policy sync_failures_insert_own_outlet on sync_failures for insert to authenticated with check (
  has_active_role(array['cashier','manager','hq','audit']) and
  (can_access_outlet(outlet_id) or (outlet_id is null and has_active_role(array['hq','audit'])))
);
drop policy if exists sync_failures_select_hq_audit on sync_failures;
create policy sync_failures_select_hq_audit on sync_failures for select to authenticated using(has_active_role(array['hq','audit']));
revoke insert on sync_failures from public,anon;
create table notification_outbox (
  id uuid primary key default gen_random_uuid(), event_key text not null unique,
  payload jsonb not null, status text not null default 'pending' check(status in ('pending','sent','failed')),
  attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
  last_error text, created_at timestamptz not null default now(), sent_at timestamptz
);
alter table notification_outbox enable row level security;
create policy notification_outbox_hq on notification_outbox for select to authenticated using(has_active_role(array['hq']));
grant select on notification_outbox to authenticated;
revoke insert,update,delete on notification_outbox from public,anon,authenticated;
create table notification_deliveries (
  notification_id uuid not null references notification_outbox(id), recipient text not null,
  accepted_at timestamptz not null default now(), primary key(notification_id,recipient)
);
alter table notification_deliveries enable row level security;
revoke all on notification_deliveries from public,anon,authenticated;

create function cash_private.enqueue_alert(url text,headers jsonb,body jsonb)
returns bigint language plpgsql set search_path=public,pg_temp as $$
declare v_key text;
begin
  v_key := coalesce(body->>'type','unknown') || ':' || coalesce(body->>'failure_id',body->>'register_id',body->>'outlet_id','global') || ':' ||
    coalesce(body->>'digest_date',body->>'created_at',body->>'closed_at','');
  insert into notification_outbox(event_key,payload) values(v_key,body) on conflict(event_key) do nothing;
  return 1;
end;
$$;
-- Preserve the exact existing event payloads while replacing the transport.
do $$
declare v_name text; v_sql text;
begin
  foreach v_name in array array['notify_shift_closed()','notify_sync_failure()','notify_shift_dispute()','send_daily_digest(date)'] loop
    select pg_get_functiondef(v_name::regprocedure) into v_sql;
    if position('perform net.http_post(' in v_sql)=0 then raise exception 'Unexpected notification definition: %',v_name; end if;
    v_sql := replace(v_sql,'perform net.http_post(','perform cash_private.enqueue_alert(');
    if v_name='notify_shift_closed()' then
      v_sql := replace(v_sql,'''cash_sales'', new.cash_sales,', '''cash_sales'', new.cash_sales, ''credits_received'', new.credits_received,');
    elsif v_name='notify_sync_failure()' then
      v_sql := replace(v_sql,'''type'', ''sync_failure'',', '''type'', ''sync_failure'', ''failure_id'', new.id,');
    elsif v_name='send_daily_digest(date)' then
      v_sql := replace(v_sql,'coalesce(sum(sr.cash_sales), 0) as total_cash_sales,','coalesce(sum(sr.cash_sales), 0) as total_cash_sales, coalesce(sum(sr.credits_received),0) as total_credits_received,');
      v_sql := replace(v_sql,'''total_cash_sales'', v_outlet.total_cash_sales,','''total_cash_sales'', v_outlet.total_cash_sales, ''total_credits_received'', v_outlet.total_credits_received,');
    end if;
    execute v_sql;
  end loop;
end;
$$;

create function dispatch_cash_notifications()
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row notification_outbox; v_url text; v_secret text;
begin
  select value into v_url from app_config where key='alert_function_url';
  select value into v_secret from app_config where key='alert_shared_secret';
  if v_url is null or v_secret is null then return; end if;
  for v_row in select * from notification_outbox where status='pending' and next_attempt_at<=now() order by created_at limit 25 for update skip locked loop
    if v_row.attempts>=8 then
      update notification_outbox set status='failed',last_error=coalesce(last_error,'Provider acceptance was not confirmed after eight attempts') where id=v_row.id;
      continue;
    end if;
    begin
      perform net.http_post(url:=v_url,headers:=jsonb_build_object('Content-Type','application/json','x-alert-secret',v_secret),
        body:=v_row.payload||jsonb_build_object('_notification_id',v_row.id));
      update notification_outbox set attempts=attempts+1,next_attempt_at=now()+interval '2 minutes' * power(2,least(attempts,6)) where id=v_row.id;
    exception when others then
      update notification_outbox set attempts=attempts+1,last_error=sqlerrm,next_attempt_at=now()+interval '5 minutes' where id=v_row.id;
    end;
  end loop;
end;
$$;
revoke all on function dispatch_cash_notifications() from public,anon,authenticated;
revoke all on function cash_private.enqueue_alert(text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function send_daily_digest(date) from public,anon,authenticated;
select cron.schedule('cash-notification-retry','* * * * *',$$select dispatch_cash_notifications()$$);

create function retry_cash_notification(p_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not has_active_role(array['hq']) then raise exception 'Only active HQ can retry alerts' using errcode='42501'; end if;
  -- Already accepted recipients stay deduplicated in notification_deliveries.
  update notification_outbox set status='pending',attempts=0,next_attempt_at=now(),last_error=null where id=p_id and status='failed';
  if not found then raise exception 'Notification is unavailable or not failed'; end if;
end;
$$;
revoke all on function retry_cash_notification(uuid) from public,anon;
grant execute on function retry_cash_notification(uuid) to authenticated;
