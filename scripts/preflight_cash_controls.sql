-- READ ONLY. Run on the intended project before applying 0027–0029.
-- Do not change these results automatically; they are reconciliation evidence.

select id,outlet_id,status,opened_at from shift_registers where status <> 'closed';

-- Bills whose recorded settlement differs from their payment ledger.
select b.id,b.outlet_id,b.bill_serial,b.bill_amount,b.amount_paid,
  coalesce(p.total,0) as ledger_paid,b.amount_paid-coalesce(p.total,0) as difference
from bills b left join lateral(select sum(amount) as total from payments where bill_id=b.id) p on true
where b.amount_paid is distinct from coalesce(p.total,0);

-- Existing held liabilities: verify against real retained cash and customer records.
select outlet_id,count(*) as held_credits,sum(amount) as held_total from customer_credits where status='held' group by outlet_id;
select id,outlet_id,amount,status,bill_id,used_against_bill_id,created_at,resolved_at from customer_credits order by created_at;

-- Expense running totals can differ if historical amounts were edited.
select sr.id,sr.outlet_id,sr.expenses_paid,coalesce(e.total,0) as expense_ledger
from shift_registers sr left join lateral(select sum(amount) as total from expenses where register_id=sr.id) e on true
where sr.expenses_paid is distinct from coalesce(e.total,0);

-- Closed-register equation using pre-release buckets. Historical credit receipts were not tracked.
select id,outlet_id,expected_closing,
 opening_balance+cash_sales+cash_collected_old_bills-expenses_paid-deposits_made-cash_returned-credits_refunded as bucket_total
from shift_registers where status='closed' and expected_closing is distinct from
 opening_balance+cash_sales+cash_collected_old_bills-expenses_paid-deposits_made-cash_returned-credits_refunded;

-- Suspected duplicate payments need human review; equal amounts alone do not prove duplication.
select bill_id,amount,mode,gateway_reference,count(*) from payments
group by bill_id,amount,mode,gateway_reference having count(*)>1;

select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname;
select grantee,table_name,privilege_type from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','authenticated','service_role') order by table_name,grantee,privilege_type;
select ordinal_position,column_name from information_schema.columns where table_schema='public' and table_name='shift_registers_readable' order by ordinal_position;
select jobname,schedule,active from cron.job;
