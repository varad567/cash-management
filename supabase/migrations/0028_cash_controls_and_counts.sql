-- Deploy with the matching frontend, after draining old offline queues.
-- Historical financial rows are deliberately not rewritten.
begin;
create schema if not exists cash_private;
revoke all on schema cash_private from public, anon, authenticated;

-- Restore the prerequisites from 0019 when 0020 was applied without it.
-- Existing credits retain an unknown original register; never infer cash history.
alter table public.customer_credits
  add column if not exists register_id uuid references public.shift_registers(id);
create index if not exists idx_credits_register on public.customer_credits(register_id);
drop trigger if exists trg_stamp_register_credits on public.customer_credits;
create trigger trg_stamp_register_credits before insert on public.customer_credits
  for each row execute function public.stamp_current_register();

create function cash_private.check_credit_bill_outlet()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_bill_outlet uuid;
begin
  if new.bill_id is not null then
    select outlet_id into v_bill_outlet from bills where id = new.bill_id;
    if v_bill_outlet is distinct from new.outlet_id then
      raise exception 'Credit outlet does not match the outlet of the originating bill';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_check_credit_bill_outlet on public.customer_credits;
create trigger trg_check_credit_bill_outlet before insert on public.customer_credits
  for each row execute function cash_private.check_credit_bill_outlet();

alter table shift_registers
  add column opening_denominations jsonb,
  add column closing_denominations jsonb,
  add column credits_received numeric(12,2) not null default 0;
alter table customer_credits add column receipt_recorded boolean not null default false;
alter table payments add column customer_credit_id uuid references customer_credits(id);
create unique index payments_one_per_credit on payments(customer_credit_id)
  where customer_credit_id is not null;
alter table payments add constraint credit_payment_link
  check ((mode = 'credit') = (customer_credit_id is not null));

create table cash_private.operations (
  id uuid primary key, actor_id uuid not null, outlet_id uuid not null,
  kind text not null, request jsonb not null, result jsonb not null,
  created_at timestamptz not null default now()
);

create or replace function public.has_active_role(p_roles text[])
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from app_users where id = auth.uid() and is_active and role::text = any(p_roles));
$$;
revoke all on function public.has_active_role(text[]) from public, anon;
grant execute on function public.has_active_role(text[]) to authenticated;

create function cash_private.require_writer(p_outlet uuid, p_roles text[] default array['cashier','manager','hq'])
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare v_user app_users;
begin
  select * into v_user from app_users where id = auth.uid() and is_active;
  if v_user.id is null or not (v_user.role::text = any(p_roles)) or
     (v_user.role <> 'hq' and v_user.outlet_id is distinct from p_outlet) then
    raise exception 'Not authorized for this outlet or action' using errcode = '42501';
  end if;
  -- One lock order for every cash mutation: outlet, register, bill/credit.
  perform 1 from outlets where id = p_outlet and is_active for update;
  if not found then raise exception 'Outlet is inactive or missing'; end if;
  return v_user.id;
end;
$$;

create function cash_private.count_cash(p_counts jsonb)
returns numeric language plpgsql immutable set search_path = public, pg_temp as $$
declare v_key text; v_value jsonb; v_count numeric; v_total numeric := 0;
begin
  if p_counts is null or jsonb_typeof(p_counts) <> 'object' or p_counts = '{}'::jsonb then
    raise exception 'Submit denomination quantities, including an explicit zero for an empty drawer';
  end if;
  for v_key, v_value in select * from jsonb_each(p_counts) loop
    if v_key <> all(array['500','200','100','50','20','10','5','2','1','0.5']) or jsonb_typeof(v_value) <> 'number' then
      raise exception 'Invalid denomination or quantity';
    end if;
    v_count := v_value::text::numeric;
    if v_count < 0 or v_count <> trunc(v_count) or v_count > 1000000 then
      raise exception 'Denomination quantities must be whole numbers from 0 to 1000000';
    end if;
    v_total := v_total + v_key::numeric * v_count;
  end loop;
  if v_total > 9999999999.99 then raise exception 'Cash count exceeds supported amount'; end if;
  return v_total;
end;
$$;

create function cash_private.money(p_value numeric, p_zero_allowed boolean default false)
returns numeric language plpgsql immutable as $$
begin
  if p_value is null or p_value::text in ('NaN','Infinity','-Infinity') or p_value < 0 or
     (not p_zero_allowed and p_value = 0) or p_value <> round(p_value,2) or p_value > 9999999999.99 then
    raise exception 'Enter a valid amount with at most two decimal places';
  end if;
  return p_value;
end;
$$;

create function cash_private.expected_cash(p_id uuid)
returns numeric language sql stable set search_path = public, pg_temp as $$
  select opening_balance + cash_sales + cash_collected_old_bills + credits_received
    - expenses_paid - deposits_made - cash_returned - credits_refunded
  from shift_registers where id = p_id;
$$;

-- Access to financial writes belongs only to the checked RPCs below.
revoke insert, update, delete, truncate, references, trigger on
  bills, payments, expenses, cash_deposits, customer_credits, shift_registers,
  returns, admissions, audit_log, sync_log from public, anon, authenticated;
drop policy if exists audit_insert on audit_log;
-- Some deployed databases lack these legacy RPCs or have different overloads.
-- Revoke every existing public overload without requiring an obsolete signature.
do $legacy_rpc_revocations$
declare v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.proname in ('record_walk_in_sale', 'use_customer_credit', 'send_daily_digest')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_function);
  end loop;
end;
$legacy_rpc_revocations$;

-- Replace stale JWT-only administrative policies with current account checks.
drop policy if exists users_insert_hq on app_users;
drop policy if exists users_update_hq on app_users;
drop policy if exists users_delete_hq on app_users;
create policy users_insert_hq on app_users for insert to authenticated with check (has_active_role(array['hq']));
create policy users_update_hq on app_users for update to authenticated using (has_active_role(array['hq'])) with check (has_active_role(array['hq']));
create policy users_delete_hq on app_users for delete to authenticated using (has_active_role(array['hq']));
drop policy if exists outlets_write_hq on outlets;
create policy outlets_write_hq on outlets for all to authenticated using (has_active_role(array['hq'])) with check (has_active_role(array['hq']));
drop policy if exists alert_recipients_select_hq on alert_recipients;
drop policy if exists alert_recipients_write_hq on alert_recipients;
create policy alert_recipients_write_hq on alert_recipients for all to authenticated using (has_active_role(array['hq'])) with check (has_active_role(array['hq']));
drop policy if exists disputes_select on shift_disputes;
create policy disputes_select on shift_disputes for select to authenticated using (
  can_access_outlet(outlet_id) and (raised_by = auth.uid() or has_active_role(array['hq','audit','manager']))
);
drop policy if exists disputes_update_hq on shift_disputes;
create policy disputes_update_hq on shift_disputes for update to authenticated using (has_active_role(array['hq'])) with check (has_active_role(array['hq']));

create or replace function enforce_dispute_window()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_reg shift_registers;
begin
  select * into v_reg from shift_registers where id = new.register_id;
  if not can_access_outlet(v_reg.outlet_id) or v_reg.closed_by is distinct from auth.uid() or v_reg.status <> 'closed' then
    raise exception 'Only the closer can dispute a closed shift';
  end if;
  if v_reg.closed_at is null or now() > v_reg.closed_at + interval '24 hours' then raise exception 'The 24-hour dispute window has passed'; end if;
  if nullif(trim(new.reason),'') is null then raise exception 'A dispute reason is required'; end if;
  new.outlet_id := v_reg.outlet_id; new.raised_by := auth.uid(); new.created_at := now();
  new.status := 'open'; new.hq_notes := null; new.reviewed_at := null; new.reviewed_by := null;
  return new;
end;
$$;

create or replace function apply_payment_to_register()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_bill_register uuid;
begin
  if new.mode = 'credit' then return new; end if;
  select register_id into v_bill_register from bills where id = new.bill_id;
  if new.mode = 'online' then
    update shift_registers set online_received = online_received + new.amount where id = new.register_id;
  elsif new.register_id = v_bill_register then
    update shift_registers set cash_sales = cash_sales + new.amount where id = new.register_id;
  else
    update shift_registers set cash_collected_old_bills = cash_collected_old_bills + new.amount where id = new.register_id;
  end if;
  return new;
end;
$$;

create or replace function check_deposit_amount()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  select id into v_id from shift_registers where outlet_id = new.outlet_id and status = 'open' for update;
  if v_id is null or new.amount > cash_private.expected_cash(v_id) then raise exception 'Deposit exceeds cash available in the drawer'; end if;
  return new;
end;
$$;

create or replace function check_return_amount()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_paid numeric; v_returned numeric;
begin
  select amount_paid into v_paid from bills where id = new.original_bill_id and status <> 'cancelled' for update;
  select coalesce(sum(amount_returned),0) into v_returned from returns where original_bill_id = new.original_bill_id;
  if v_paid is null or new.amount_returned > v_paid - v_returned then raise exception 'Return exceeds the remaining paid amount'; end if;
  return new;
end;
$$;
create or replace function check_return_approver()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.approved_by is distinct from auth.uid() or not exists (
    select 1 from app_users where id = auth.uid() and is_active and
      (role = 'hq' or (role = 'manager' and outlet_id = new.outlet_id))
  ) then raise exception 'The signed-in manager or HQ user must approve the return'; end if;
  return new;
end;
$$;

create function cash_private.credit_received()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.receipt_recorded then update shift_registers set credits_received = credits_received + new.amount where id = new.register_id; end if;
  return new;
end;
$$;
create trigger trg_credit_received after insert on customer_credits for each row execute function cash_private.credit_received();
create trigger trg_audit_credits after insert or update or delete on customer_credits for each row execute function log_audit();

create or replace function refund_customer_credit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if (new.amount,new.outlet_id,new.bill_id,new.register_id,new.receipt_recorded) is distinct from
     (old.amount,old.outlet_id,old.bill_id,old.register_id,old.receipt_recorded) then raise exception 'Credit financial fields are immutable'; end if;
  if new.status is distinct from old.status then
    if old.status <> 'held' or new.status not in ('adjusted','refunded') then raise exception 'Credit has already been settled'; end if;
    if new.status = 'refunded' then
      select id into v_id from shift_registers where outlet_id = new.outlet_id and status = 'open' for update;
      if v_id is null or new.amount > cash_private.expected_cash(v_id) then raise exception 'Insufficient cash or no open shift for refund'; end if;
      new.refunded_register_id := v_id; new.refunded_by := auth.uid();
    end if;
    new.resolved_at := now();
  end if;
  return new;
end;
$$;

-- 0020 replaces the function but does not recreate this 0019 trigger.
drop trigger if exists trg_refund_customer_credit on public.customer_credits;
create trigger trg_refund_customer_credit before update on public.customer_credits
  for each row execute function public.refund_customer_credit();

create or replace function enforce_shift_close_rules()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status = 'closed' and old.status <> 'closed' then
    if old.status <> 'open' then raise exception 'Only an open shift can be closed'; end if;
    new.counted_closing := cash_private.count_cash(new.closing_denominations);
    new.expected_closing := cash_private.expected_cash(old.id);
    new.mismatch := new.counted_closing - new.expected_closing;
    new.closed_at := now(); new.closed_by := auth.uid();
  end if;
  return new;
end;
$$;

create function open_cash_shift(p_outlet_id uuid, p_denominations jsonb, p_label text default null)
returns shift_registers language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid; v_prev shift_registers; v_result shift_registers; v_total numeric;
begin
  v_actor := cash_private.require_writer(p_outlet_id);
  if exists(select 1 from shift_registers where outlet_id=p_outlet_id and status in ('open','pending_sync','flagged')) then raise exception 'Resolve the existing shift before opening another'; end if;
  v_total := cash_private.count_cash(p_denominations);
  select * into v_prev from shift_registers where outlet_id=p_outlet_id and status='closed' order by closed_at desc limit 1;
  if v_prev.id is not null and v_total is distinct from v_prev.counted_closing then raise exception 'Denomination total must match the previous closing count (%)',v_prev.counted_closing; end if;
  insert into shift_registers(outlet_id,register_date,opening_balance,opening_denominations,previous_register_id,shift_label,opened_by)
    values(p_outlet_id,(now() at time zone 'Asia/Kolkata')::date,v_total,p_denominations,v_prev.id,nullif(trim(p_label),''),v_actor) returning * into v_result;
  return v_result;
end;
$$;
create function close_cash_shift(p_register_id uuid, p_denominations jsonb)
returns shift_registers language plpgsql security definer set search_path = public, pg_temp as $$
declare v_reg shift_registers; v_outlet uuid;
begin
  select outlet_id into v_outlet from shift_registers where id = p_register_id;
  perform cash_private.require_writer(v_outlet);
  select * into v_reg from shift_registers where id=p_register_id for update;
  if v_reg.status <> 'open' then raise exception 'Shift is already closed or unavailable'; end if;
  if exists(select 1 from return_requests where register_id=p_register_id and status='pending') then raise exception 'Approve or reject pending returns before closing this shift'; end if;
  update shift_registers set closing_denominations=p_denominations,status='closed' where id=p_register_id returning * into v_reg;
  return v_reg;
end;
$$;

create table return_requests (
  id uuid primary key default gen_random_uuid(), outlet_id uuid not null references outlets(id),
  register_id uuid not null references shift_registers(id), original_bill_id uuid not null references bills(id),
  amount_returned numeric(12,2) not null check(amount_returned > 0), reason text not null,
  stock_reversed boolean not null default false, created_by uuid not null references app_users(id),
  created_at timestamptz not null default now(), status text not null default 'pending' check(status in ('pending','approved','rejected')),
  reviewed_by uuid references app_users(id), reviewed_at timestamptz, return_id uuid references returns(id)
);
alter table return_requests enable row level security;
grant select on return_requests to authenticated;
revoke insert,update,delete on return_requests from public,anon,authenticated;
create policy return_requests_select on return_requests for select to authenticated using(can_access_outlet(outlet_id));
create index return_requests_pending on return_requests(register_id) where status='pending';
create trigger trg_audit_return_requests after insert or update on return_requests for each row execute function log_audit();

create function cash_private.insert_payment(p_bill uuid,p_outlet uuid,p_amount numeric,p_mode payment_mode,p_ref text,p_actor uuid,p_date date,p_credit uuid default null)
returns void language plpgsql set search_path = public, pg_temp as $$
declare v_bill bills;
begin
  perform cash_private.money(p_amount);
  select * into v_bill from bills where id=p_bill and outlet_id=p_outlet for update;
  if v_bill.id is null or v_bill.status='cancelled' or p_amount > v_bill.balance_due then raise exception 'Payment exceeds balance or bill is unavailable'; end if;
  if p_mode='online' and nullif(trim(p_ref),'') is null then raise exception 'Online payment requires a reference'; end if;
  insert into payments(bill_id,outlet_id,amount,mode,gateway_reference,received_by,register_date,customer_credit_id)
    values(p_bill,p_outlet,p_amount,p_mode,nullif(trim(p_ref),''),p_actor,p_date,p_credit);
end;
$$;

-- All queued writes commit their deduplication receipt and business changes together.
create function submit_cash_action(p_operation_id uuid,p_kind text,p_payload jsonb,p_register_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid; v_outlet uuid; v_reg shift_registers; v_saved cash_private.operations;
  v_request jsonb; v_result jsonb; v_id uuid; v_amount numeric; v_cash numeric; v_online numeric;
  v_date date; v_credit customer_credits; v_bill bills;
begin
  v_outlet := (p_payload->>'outlet_id')::uuid;
  v_actor := cash_private.require_writer(v_outlet);
  if p_actor_id is distinct from v_actor or p_operation_id is null or p_register_id is null then raise exception 'Operation must belong to this user and a known shift'; end if;
  v_request := jsonb_build_object('payload',p_payload,'register_id',p_register_id);
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_saved from cash_private.operations where id=p_operation_id;
  if v_saved.id is not null then
    if v_saved.actor_id<>v_actor or v_saved.kind<>p_kind or v_saved.request<>v_request then raise exception 'Operation ID was already used for a different request'; end if;
    return v_saved.result;
  end if;
  select * into v_reg from shift_registers where id=p_register_id and outlet_id=v_outlet and status='open' for update;
  if v_reg.id is null then raise exception 'Original shift is no longer open; ask HQ to reconcile this entry'; end if;
  v_date := coalesce((p_payload->>'register_date')::date,(now() at time zone 'Asia/Kolkata')::date);
  if v_date < (v_reg.opened_at at time zone 'Asia/Kolkata')::date or v_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'Transaction date is outside this shift'; end if;
  v_id := coalesce((p_payload->>'id')::uuid,gen_random_uuid());
  if p_kind in ('sale','bills') then
    v_amount := cash_private.money((p_payload->>'bill_amount')::numeric);
    if nullif(trim(p_payload->>'bill_serial'),'') is null then raise exception 'Bill number is required'; end if;
    if p_payload->>'bill_type'='admitted_patient' then
      perform 1 from admissions where id=(p_payload->>'admission_id')::uuid and outlet_id=v_outlet and status='admitted' for update;
      if not found then raise exception 'Select an active admission at this outlet'; end if;
    end if;
    v_cash := cash_private.money(coalesce((p_payload->>'cash_amount')::numeric,0),true);
    v_online := cash_private.money(coalesce((p_payload->>'online_amount')::numeric,0),true);
    if (p_payload->>'bill_type'='walk_in' and v_cash+v_online<>v_amount) or v_cash+v_online>v_amount then raise exception 'Cash plus online must match a walk-in bill and cannot exceed any bill amount'; end if;
    insert into bills(id,outlet_id,bill_serial,bill_type,admission_id,bill_amount,register_date,created_by)
      values(v_id,v_outlet,trim(p_payload->>'bill_serial'),(p_payload->>'bill_type')::bill_type,(p_payload->>'admission_id')::uuid,v_amount,v_date,v_actor);
    if v_cash>0 then perform cash_private.insert_payment(v_id,v_outlet,v_cash,'cash',null,v_actor,v_date); end if;
    if v_online>0 then perform cash_private.insert_payment(v_id,v_outlet,v_online,'online',p_payload->>'gateway_reference',v_actor,v_date); end if;
  elsif p_kind='payments' then
    if p_payload->>'mode' not in ('cash','online') or p_payload->>'mode' is null then raise exception 'Use the credit settlement operation for credits'; end if;
    perform cash_private.insert_payment((p_payload->>'bill_id')::uuid,v_outlet,(p_payload->>'amount')::numeric,(p_payload->>'mode')::payment_mode,p_payload->>'gateway_reference',v_actor,v_date);
  elsif p_kind='expenses' then
    v_amount := cash_private.money((p_payload->>'amount')::numeric);
    if nullif(trim(p_payload->>'reason'),'') is null or split_part(coalesce(p_payload->>'receipt_url',''),'/',1)<>v_outlet::text then raise exception 'A reason and receipt in this outlet folder are required'; end if;
    if v_amount>cash_private.expected_cash(v_reg.id) then raise exception 'Expense exceeds available cash'; end if;
    insert into expenses(id,outlet_id,amount,reason,receipt_url,requires_hq_approval,register_date,created_by)
      values(v_id,v_outlet,v_amount,trim(p_payload->>'reason'),p_payload->>'receipt_url',v_amount>=5000,v_date,v_actor);
  elsif p_kind='cash_deposits' then
    v_amount := cash_private.money((p_payload->>'amount')::numeric);
    insert into cash_deposits(id,outlet_id,amount,bank_reference,deposited_by,register_date) values(v_id,v_outlet,v_amount,p_payload->>'bank_reference',v_actor,v_date);
  elsif p_kind='admissions' then
    if nullif(trim(p_payload->>'patient_name'),'') is null then raise exception 'Patient name is required'; end if;
    insert into admissions(id,outlet_id,patient_name,ward_bed,referring_doctor,created_by) values(v_id,v_outlet,trim(p_payload->>'patient_name'),p_payload->>'ward_bed',p_payload->>'referring_doctor',v_actor);
  elsif p_kind='customer_credits' then
    v_amount := cash_private.money((p_payload->>'amount')::numeric);
    if nullif(trim(p_payload->>'reason'),'') is null then raise exception 'Credit reason is required'; end if;
    insert into customer_credits(id,outlet_id,bill_id,amount,reason,created_by,receipt_recorded) values(v_id,v_outlet,(p_payload->>'bill_id')::uuid,v_amount,trim(p_payload->>'reason'),v_actor,true);
  elsif p_kind in ('credit_apply','credit_refund') then
    select * into v_credit from customer_credits where id=(p_payload->>'credit_id')::uuid and outlet_id=v_outlet for update;
    if v_credit.id is null or v_credit.status<>'held' then raise exception 'Credit is unavailable or already settled'; end if;
    if p_kind='credit_apply' then
      perform cash_private.insert_payment((p_payload->>'bill_id')::uuid,v_outlet,v_credit.amount,'credit',null,v_actor,v_date,v_credit.id);
      update customer_credits set status='adjusted',used_against_bill_id=(p_payload->>'bill_id')::uuid where id=v_credit.id;
    else update customer_credits set status='refunded' where id=v_credit.id;
    end if;
    v_id := v_credit.id;
  elsif p_kind='returns' then
    v_amount := cash_private.money((p_payload->>'amount_returned')::numeric);
    select * into v_bill from bills where id=(p_payload->>'original_bill_id')::uuid and outlet_id=v_outlet and status<>'cancelled' for update;
    if v_bill.id is null or nullif(trim(p_payload->>'reason'),'') is null or v_amount>v_bill.amount_paid-coalesce((select sum(amount_returned) from returns where original_bill_id=v_bill.id),0) then raise exception 'Invalid return request'; end if;
    insert into return_requests(id,outlet_id,register_id,original_bill_id,amount_returned,reason,stock_reversed,created_by)
      values(v_id,v_outlet,v_reg.id,v_bill.id,v_amount,trim(p_payload->>'reason'),coalesce((p_payload->>'stock_reversed')::boolean,false),v_actor);
  else raise exception 'Unsupported cash operation';
  end if;
  v_result := jsonb_build_object('id',v_id);
  insert into cash_private.operations(id,actor_id,outlet_id,kind,request,result) values(p_operation_id,v_actor,v_outlet,p_kind,v_request,v_result);
  return v_result;
end;
$$;

create function review_cash_return(p_request_id uuid,p_approve boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_req return_requests; v_outlet uuid; v_actor uuid; v_return uuid;
begin
  select outlet_id into v_outlet from return_requests where id=p_request_id;
  v_actor := cash_private.require_writer(v_outlet,array['manager','hq']);
  select * into v_req from return_requests where id=p_request_id for update;
  if v_req.status <> 'pending' then raise exception 'Return already reviewed'; end if;
  if p_approve is null then raise exception 'Choose approve or reject'; end if;
  if p_approve then
    perform 1 from shift_registers where id=v_req.register_id and status='open' for update;
    if not found or v_req.amount_returned>cash_private.expected_cash(v_req.register_id) then raise exception 'Original shift is closed or has insufficient cash'; end if;
    insert into returns(outlet_id,original_bill_id,amount_returned,reason,stock_reversed,approved_by,created_by,register_date)
      values(v_outlet,v_req.original_bill_id,v_req.amount_returned,v_req.reason,v_req.stock_reversed,v_actor,v_req.created_by,(now() at time zone 'Asia/Kolkata')::date) returning id into v_return;
  end if;
  update return_requests set status=case when p_approve then 'approved' else 'rejected' end,reviewed_by=v_actor,reviewed_at=now(),return_id=v_return where id=p_request_id;
end;
$$;

create function approve_cash_expense(p_expense_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_outlet uuid; v_actor uuid;
begin
  select outlet_id into v_outlet from expenses where id=p_expense_id;
  v_actor := cash_private.require_writer(v_outlet,array['hq']);
  update expenses set approved_by=v_actor,approved_at=now() where id=p_expense_id and approved_by is null;
  if not found then raise exception 'Expense unavailable or already approved'; end if;
end;
$$;
create or replace function check_expense_approval()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (new.amount,new.outlet_id,new.register_id,new.requires_hq_approval) is distinct from (old.amount,old.outlet_id,old.register_id,old.requires_hq_approval) then raise exception 'Expense financial fields are immutable'; end if;
  if new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
    if not has_active_role(array['hq']) or new.approved_by is distinct from auth.uid() then raise exception 'Only active HQ can approve an expense'; end if;
  end if;
  return new;
end;
$$;
create function discharge_cash_patient(p_admission_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_outlet uuid;
begin
  select outlet_id into v_outlet from admissions where id=p_admission_id;
  perform cash_private.require_writer(v_outlet);
  update admissions set status='discharged',discharged_at=now() where id=p_admission_id and status='admitted';
  if not found then raise exception 'Admission unavailable or already discharged'; end if;
end;
$$;

revoke execute on function open_cash_shift(uuid,jsonb,text),close_cash_shift(uuid,jsonb),
  submit_cash_action(uuid,text,jsonb,uuid,uuid),review_cash_return(uuid,boolean),approve_cash_expense(uuid),discharge_cash_patient(uuid) from public,anon;
grant execute on function open_cash_shift(uuid,jsonb,text),close_cash_shift(uuid,jsonb),
  submit_cash_action(uuid,text,jsonb,uuid,uuid),review_cash_return(uuid,boolean),approve_cash_expense(uuid),discharge_cash_patient(uuid) to authenticated;
revoke all on all functions in schema cash_private from public,anon,authenticated;

-- CSV is bill-level: no join multiplication between split payments and returns.
create view bill_reconciliation with (security_invoker=true) as
select b.id,b.outlet_id,o.name as outlet_name,b.bill_serial,b.register_date,b.created_at,
  b.bill_type,b.bill_amount,b.status,b.amount_paid,b.balance_due,
  coalesce(p.cash_paid,0) as cash_paid,coalesce(p.online_paid,0) as online_paid,
  coalesce(p.credit_applied,0) as credit_applied,coalesce(p.payment_total,0) as payment_total,
  coalesce(p.online_references,'') as online_references,coalesce(r.returned_amount,0) as returned_amount,
  b.amount_paid-coalesce(p.payment_total,0) as ledger_difference
from bills b join outlets o on o.id=b.outlet_id
left join lateral(select sum(amount) filter(where mode='cash') as cash_paid,
  sum(amount) filter(where mode='online') as online_paid,sum(amount) filter(where mode='credit') as credit_applied,
  sum(amount) as payment_total,string_agg(distinct gateway_reference,'; ') filter(where mode='online') as online_references
  from payments where bill_id=b.id) p on true
left join lateral(select sum(amount_returned) as returned_amount from returns where original_bill_id=b.id) r on true;
grant select on bill_reconciliation to authenticated;

-- Append new columns to the existing view without changing old column positions.
create or replace view shift_registers_readable with (security_invoker=true) as
select sr.id,sr.outlet_id,sr.register_date,sr.opening_balance,sr.cash_sales,sr.cash_collected_old_bills,
 sr.online_received,sr.expenses_paid,sr.deposits_made,sr.expected_closing,sr.counted_closing,sr.mismatch,
 sr.status,sr.closed_by,sr.closed_at,sr.created_at,sr.opened_at,sr.opened_by,sr.previous_register_id,sr.shift_label,
 sr.cash_returned,o.name as outlet_name,coalesce(au_open.full_name,'Unknown') as opened_by_name,
 au_close.full_name as closed_by_name,sr.credits_refunded,sr.opening_denominations,sr.closing_denominations,sr.credits_received
from shift_registers sr join outlets o on o.id=sr.outlet_id
left join app_users au_open on au_open.id=sr.opened_by left join app_users au_close on au_close.id=sr.closed_by;

-- New receipt entries complement the existing immutable transaction ledger.
create view credit_receipt_entries with (security_invoker=true) as
select register_id,outlet_id,'credit_received'::text as entry_type,amount,'Customer credit: '||reason as description,
 created_by,created_at from customer_credits where receipt_recorded;
grant select on credit_receipt_entries to authenticated;

commit;
