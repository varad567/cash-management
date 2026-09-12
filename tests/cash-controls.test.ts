import { beforeAll,afterAll,beforeEach,afterEach,describe,it,expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createDatabase,asUser,action,ids } from './helpers/database';
let db: PGlite; let register: string; let bill: string;
async function rows(sql: string) { return (await db.query(sql)).rows as Record<string,unknown>[]; }
async function rejected(sql: string, pattern: RegExp) {
  await db.exec('savepoint reject_test');
  try { await expect(db.exec(sql)).rejects.toThrow(pattern); } finally { await db.exec('rollback to savepoint reject_test'); }
}
beforeAll(async()=>{db=await createDatabase();},60000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{
  await db.exec('reset role; begin');await asUser(db);
  register=(await db.query<{id:string}>(`select id from open_cash_shift($1,'{"500":2}'::jsonb,'Test')`,[ids.outlet])).rows[0].id;
  await action(db,register,'admissions',{id:ids.admission,patient_name:'Synthetic patient'});
  bill=(await action(db,register,'sale',{bill_serial:'TEST-001',bill_type:'admitted_patient',admission_id:ids.admission,bill_amount:1000,cash_amount:0,online_amount:0})).id;
});
afterEach(async()=>{await db.exec('rollback; reset role');});
describe('cash database controls after every migration',()=>{
  it('blocks a fabricated close and records a real shortage from quantities',async()=>{
    await rejected(`update shift_registers set expected_closing=700,counted_closing=700,status='closed' where id='${register}'`,/permission denied/);
    const r=await rows(`select expected_closing,counted_closing,mismatch,closing_denominations from close_cash_shift('${register}','{"500":1,"200":1}')`);
    expect(r[0]).toMatchObject({expected_closing:'1000.00',counted_closing:'700.00',mismatch:'-300.00',closing_denominations:{'500':1,'200':1}});
    await rejected(`select close_cash_shift('${register}','{"500":2}')`,/already closed/);
  });
  it('closes against the latest committed payment, not an earlier UI snapshot',async()=>{
    await action(db,register,'payments',{bill_id:bill,amount:100,mode:'cash'});
    expect((await rows(`select mismatch from close_cash_shift('${register}','{"500":2,"100":1}')`))[0].mismatch).toBe('0.00');
  });
  it('requires valid quantities and enforces the next handover',async()=>{
    await rejected(`select close_cash_shift('${register}','{"500":-1}')`,/whole numbers/);
    await rejected(`select close_cash_shift('${register}','{"500":1.5}')`,/whole numbers/);
    await rejected(`select close_cash_shift('${register}','{"7":1}')`,/Invalid denomination/);
    await rejected(`select close_cash_shift('${register}','{}')`,/Submit denomination/);
    await db.exec(`select close_cash_shift('${register}','{"500":2}')`);
    await rejected(`select open_cash_shift('${ids.outlet}','{"500":1}')`,/previous closing/);
    expect((await rows(`select opening_balance,opening_denominations from open_cash_shift('${ids.outlet}','{"200":5}')`))[0]).toMatchObject({opening_balance:'1000.00',opening_denominations:{'200':5}});
  });
  it('does not allow fake paid bills or discharge with a balance',async()=>{
    await rejected(`update bills set amount_paid=1000 where id='${bill}'`,/permission denied/);
    await rejected(`select discharge_cash_patient('${ids.admission}')`,/outstanding balance/);
  });
  it('saves cash plus online walk-in payment atomically and idempotently',async()=>{
    const payload={bill_serial:'SPLIT-001',bill_type:'walk_in',bill_amount:1000,cash_amount:300,online_amount:700,gateway_reference:'UPI-123'};
    const op=crypto.randomUUID();const first=await action(db,register,'sale',payload,op);const retry=await action(db,register,'sale',payload,op);
    expect(first).toEqual(retry);
    expect((await rows(`select cash_paid,online_paid,payment_total,balance_due from bill_reconciliation where id='${first.id}'`))[0]).toMatchObject({cash_paid:'300.00',online_paid:'700.00',payment_total:'1000.00',balance_due:'0.00'});
    expect((await rows(`select cash_sales,online_received from shift_registers where id='${register}'`))[0]).toMatchObject({cash_sales:'300.00',online_received:'700.00'});
    expect((await rows(`select count(*) as n from payments where bill_id='${first.id}'`))[0].n).toBe(2);
  });
  it('rolls back incomplete splits and missing online references',async()=>{
    await db.exec('savepoint invalid_sale');
    await expect(action(db,register,'sale',{bill_serial:'BAD',bill_type:'walk_in',bill_amount:100,cash_amount:20,online_amount:70})).rejects.toThrow(/Cash plus online/);
    await db.exec('rollback to savepoint invalid_sale');
    await expect(action(db,register,'sale',{bill_serial:'BAD',bill_type:'walk_in',bill_amount:100,cash_amount:20,online_amount:80})).rejects.toThrow(/reference/);
    await db.exec('rollback to savepoint invalid_sale');
    expect((await rows(`select count(*) as n from bills where bill_serial='BAD'`))[0].n).toBe(0);
  });
  it('rejects changed content using the same operation ID and closed-shift replay',async()=>{
    const op=crypto.randomUUID();const payload={bill_id:bill,amount:100,mode:'cash'};
    await action(db,register,'payments',payload,op);
    await db.exec('savepoint changed');
    await expect(action(db,register,'payments',{...payload,amount:200},op)).rejects.toThrow(/different request/);
    await db.exec('rollback to savepoint changed');
    await db.exec(`select close_cash_shift('${register}','{"500":2,"100":1}')`);
    await action(db,register,'payments',payload,op); // a lost success response remains recoverable after close
    await expect(action(db,register,'payments',payload)).rejects.toThrow(/Original shift/);
  });
  it('does not trust caller-supplied expense approvals or allow amount edits',async()=>{
    await rejected(`insert into expenses(outlet_id,amount,reason,approved_by,register_date,created_by) values('${ids.outlet}',100,'fake','${ids.hq}',current_date,'${ids.cashier}')`,/permission denied/);
    const expense=await action(db,register,'expenses',{amount:100,reason:'Receipt',receipt_url:`${ids.outlet}/receipt.jpg`,approved_by:ids.hq,requires_hq_approval:true});
    expect((await rows(`select approved_by,requires_hq_approval from expenses where id='${expense.id}'`))[0]).toMatchObject({approved_by:null,requires_hq_approval:false});
    await rejected(`update expenses set amount=900 where id='${expense.id}'`,/permission denied/);
    await rejected(`select approve_cash_expense('${expense.id}')`,/Not authorized/);
    await asUser(db,ids.hq,'hq',null);await db.exec(`select approve_cash_expense('${expense.id}')`);
    expect((await rows(`select approved_by from expenses where id='${expense.id}'`))[0].approved_by).toBe(ids.hq);
  });
  it('requires a manager session to approve a return and caps cash returned',async()=>{
    await action(db,register,'payments',{bill_id:bill,amount:100,mode:'cash'});
    const req=await action(db,register,'returns',{original_bill_id:bill,amount_returned:100,reason:'Return',approved_by:ids.hq});
    expect((await rows(`select count(*) as n from returns`))[0].n).toBe(0);
    await rejected(`select review_cash_return('${req.id}',true)`,/Not authorized/);
    await rejected(`select close_cash_shift('${register}','{"500":2}')`,/pending returns/);
    await asUser(db,ids.manager,'manager');await db.exec(`select review_cash_return('${req.id}',true)`);
    expect((await rows(`select approved_by,amount_returned from returns`))[0]).toMatchObject({approved_by:ids.manager,amount_returned:'100.00'});
    await rejected(`select review_cash_return('${req.id}',true)`,/already reviewed/);
  });
  it('records credit receipt and refunds without losing or inventing cash',async()=>{
    const credit=await action(db,register,'customer_credits',{amount:100,reason:'Excess'});
    expect((await rows(`select credits_received from shift_registers where id='${register}'`))[0].credits_received).toBe('100.00');
    await action(db,register,'credit_refund',{credit_id:credit.id});
    expect((await rows(`select mismatch from close_cash_shift('${register}','{"500":2}')`))[0].mismatch).toBe('0.00');
    await asUser(db,ids.hq,'hq',null);
    expect(Number((await rows(`select count(*) as n from audit_log where table_name='customer_credits'`))[0].n)).toBe(2);
  });
  it('applies credit without a new cash receipt and prevents reuse or refund',async()=>{
    const credit=await action(db,register,'customer_credits',{amount:100,reason:'Excess'});
    await action(db,register,'credit_apply',{credit_id:credit.id,bill_id:bill});
    expect((await rows(`select cash_sales,credits_received from shift_registers where id='${register}'`))[0]).toMatchObject({cash_sales:'0.00',credits_received:'100.00'});
    expect((await rows(`select credit_applied,payment_total from bill_reconciliation where id='${bill}'`))[0]).toMatchObject({credit_applied:'100.00',payment_total:'100.00'});
    await rejected(`update customer_credits set status='held' where id='${credit.id}'`,/permission denied/);
    await expect(action(db,register,'credit_refund',{credit_id:credit.id})).rejects.toThrow(/already settled/);
  });
  it('includes refunds in the deposit cap',async()=>{
    const credit=await action(db,register,'customer_credits',{amount:100,reason:'Excess'});
    await action(db,register,'credit_refund',{credit_id:credit.id});
    await expect(action(db,register,'cash_deposits',{amount:1001})).rejects.toThrow(/Deposit exceeds/);
  });
  it('blocks fabricated audit events and read-only auditor writes',async()=>{
    await rejected(`insert into audit_log(table_name,record_id,action,changed_by) values('bills','${bill}','APPROVE','${ids.hq}')`,/permission denied/);
    await asUser(db,ids.audit,'audit',null);
    await expect(action(db,register,'payments',{bill_id:bill,amount:100,mode:'cash'},crypto.randomUUID(),ids.audit)).rejects.toThrow(/Not authorized/);
  });
  it('scopes disputes to the manager outlet and blocks anonymous digest execution',async()=>{
    await db.exec(`select close_cash_shift('${register}','{"500":2}');insert into shift_disputes(register_id,outlet_id,raised_by,reason) values('${register}','${ids.outlet2}','${ids.cashier}','Synthetic objection')`);
    await asUser(db,ids.other,'manager',ids.outlet2);expect(await rows('select * from shift_disputes')).toHaveLength(0);
    await db.exec('reset role;set role anon');await rejected('select send_daily_digest(current_date)',/permission denied/);
    await rejected(`insert into sync_failures(outlet_id,device_id,table_name,error_message) values(null,'fake','payments','spam')`,/permission denied/);
  });
  it('rejects inactive HQ despite old JWT claims',async()=>{
    await db.exec(`reset role;update app_users set is_active=false where id='${ids.hq}'`);
    await asUser(db,ids.hq,'hq',null);expect((await rows(`select has_active_role(array['hq']) as allowed`))[0].allowed).toBe(false);
    await expect(action(db,register,'payments',{bill_id:bill,amount:100,mode:'cash'},crypto.randomUUID(),ids.hq)).rejects.toThrow(/Not authorized/);
  });
  it('enqueues notifications and retries without marking them sent prematurely',async()=>{
    await db.exec(`select close_cash_shift('${register}','{"500":2}');reset role; select dispatch_cash_notifications()`);
    expect((await rows('select status,attempts from notification_outbox'))[0]).toMatchObject({status:'pending',attempts:1});
    expect((await rows('select count(*) as n from net.requests'))[0].n).toBe(1);
  });
  it('enforces the expense approval threshold on the server',async()=>{
    await action(db,register,'customer_credits',{amount:6000,reason:'Funding for synthetic test'});
    const expense=await action(db,register,'expenses',{amount:5000,reason:'Large expense',receipt_url:`${ids.outlet}/receipt.jpg`,requires_hq_approval:false});
    expect((await rows(`select requires_hq_approval,approved_by from expenses where id='${expense.id}'`))[0]).toMatchObject({requires_hq_approval:true,approved_by:null});
  });
  it('settles a prior-shift credit without inflating the new shift cash',async()=>{
    const credit=await action(db,register,'customer_credits',{amount:100,reason:'Excess'});
    await db.exec(`select close_cash_shift('${register}','{"500":2,"100":1}')`);
    const next=(await rows(`select id from open_cash_shift('${ids.outlet}','{"500":2,"100":1}')`))[0].id as string;
    await action(db,next,'credit_apply',{credit_id:credit.id,bill_id:bill});
    expect((await rows(`select cash_sales,cash_collected_old_bills from shift_registers where id='${next}'`))[0]).toMatchObject({cash_sales:'0.00',cash_collected_old_bills:'0.00'});
    expect((await rows(`select mismatch from close_cash_shift('${next}','{"500":2,"100":1}')`))[0].mismatch).toBe('0.00');
  });
  it('does not multiply split payment totals when a bill has multiple returns',async()=>{
    const sale=await action(db,register,'sale',{bill_serial:'CSV-RETURNS',bill_type:'walk_in',bill_amount:1000,cash_amount:300,online_amount:700,gateway_reference:'UPI'});
    const a=await action(db,register,'returns',{original_bill_id:sale.id,amount_returned:50,reason:'First'});
    const b=await action(db,register,'returns',{original_bill_id:sale.id,amount_returned:25,reason:'Second'});
    await asUser(db,ids.manager,'manager');await db.exec(`select review_cash_return('${a.id}',true);select review_cash_return('${b.id}',true)`);
    expect((await rows(`select cash_paid,online_paid,payment_total,returned_amount from bill_reconciliation where id='${sale.id}'`))[0]).toMatchObject({cash_paid:'300.00',online_paid:'700.00',payment_total:'1000.00',returned_amount:'75.00'});
  });
  it('blocks wrong-outlet actions and forged credit-mode payments',async()=>{
    await db.exec('savepoint invalid_action');
    await expect(action(db,register,'payments',{outlet_id:ids.outlet2,bill_id:bill,amount:100,mode:'cash'})).rejects.toThrow(/Not authorized/);
    await db.exec('rollback to savepoint invalid_action');
    await expect(action(db,register,'payments',{bill_id:bill,amount:100,mode:'credit'})).rejects.toThrow(/credit settlement/);
  });
  it('adds the new credit bucket to shift and daily notification payloads',async()=>{
    await action(db,register,'customer_credits',{amount:100,reason:'Excess'});
    await db.exec(`select close_cash_shift('${register}','{"500":2,"100":1}');reset role; select send_daily_digest((now() at time zone 'Asia/Kolkata')::date)`);
    const events=await rows(`select payload from notification_outbox order by created_at`);
    expect(events.map(e=>e.payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({type:'shift_closed',credits_received:100}),expect.objectContaining({type:'daily_digest',total_credits_received:100})
    ]));
  });
});
