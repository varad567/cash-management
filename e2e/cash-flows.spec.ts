import { test,expect,type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const actor='10000000-0000-0000-0000-000000000001',outlet='20000000-0000-0000-0000-000000000001',registerId='30000000-0000-0000-0000-000000000001';
const reg={id:registerId,outlet_id:outlet,status:'open',register_date:'2026-09-12',opening_balance:1000,cash_sales:0,cash_collected_old_bills:0,online_received:0,expenses_paid:0,deposits_made:0,cash_returned:0,credits_received:0,credits_refunded:0,opened_at:'2026-09-12T00:00:00Z',opened_by:actor,expected_closing:null,counted_closing:null,closed_at:null,closed_by:null};
async function setup(page:Page,opening=false) {
 const calls:{name:string;body:any}[]=[];
 await page.addInitScript(({actor})=>{
  const encode=(o:unknown)=>btoa(JSON.stringify(o)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const token=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:actor,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})}.synthetic`;
  localStorage.setItem('sb-cash-test-auth-token',JSON.stringify({access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:actor,aud:'authenticated',role:'authenticated',email:'cashier@example.invalid'}}));
 },{actor});
 await page.route('https://cash-test.invalid/**',async route=>{
   const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop()!;
   const body=req.postDataJSON();
   let data:any=[];
   if(url.pathname.includes('/rpc/')) {
    calls.push({name:table,body});
    if(table==='submit_cash_action')data={id:'new-bill'};
    if(table==='open_cash_shift')data={...reg,opening_balance:1000,opening_denominations:body.p_denominations};
    if(table==='close_cash_shift')data={...reg,status:'closed',expected_closing:1000,counted_closing:1000,mismatch:0,closing_denominations:body.p_denominations};
   }else if(table==='app_users')data={id:actor,outlet_id:outlet,full_name:'Test cashier',role:'cashier',is_active:true};
   else if(table==='shift_registers') {
    if(url.searchParams.get('status')==='eq.closed')data=opening?[{...reg,status:'closed',counted_closing:1000,closed_at:'2026-09-11T23:59:00Z'}]:[];
    else data=opening?[]:req.headers().accept?.includes('vnd.pgrst.object')?reg:[reg];
   }else if(table==='bill_reconciliation')data=url.searchParams.has('id')?[]:[{id:'b1',outlet_id:outlet,outlet_name:'Test outlet',bill_serial:'00123',register_date:'2026-09-12',created_at:'2026-09-12T00:00:00Z',bill_type:'walk_in',bill_amount:1000,cash_paid:300,online_paid:700,credit_applied:0,amount_paid:1000,payment_total:1000,balance_due:0,returned_amount:0,ledger_difference:0,status:'paid',online_references:'UPI-123'}];
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 return calls;
}
test('walk-in bill accepts cash + online and submits one atomic action',async({page})=>{
 const calls=await setup(page);await page.goto('/new-bill');
 await page.getByLabel('Bill number from billing software').fill('00123');await page.getByLabel('Bill amount (₹)').fill('1000');
 await page.getByLabel('Payment method').selectOption('split');await page.getByLabel('Cash received (₹)').fill('300');await page.getByLabel('Online received (₹)').fill('700');await page.getByLabel('Online transaction reference').fill('UPI-123');
 await page.getByRole('button',{name:'Save bill and payment'}).click();await expect(page.getByText('Bill saved on this device')).toBeVisible();
 await expect.poll(()=>calls.filter(c=>c.name==='submit_cash_action').length).toBe(1);
 expect(calls[0].body).toMatchObject({p_kind:'sale',p_actor_id:actor,p_register_id:registerId,p_payload:{cash_amount:300,online_amount:700,bill_serial:'00123'}});
});
test('opening requires denomination count matching the handover',async({page})=>{
 const calls=await setup(page,true);await page.goto('/');
 await page.getByLabel('Opening cash count: quantity of ₹500',{exact:true}).fill('1');await page.getByRole('checkbox').check();
 await expect(page.getByRole('button',{name:'Confirm & Start Shift'})).toBeDisabled();
 await page.getByLabel('Opening cash count: quantity of ₹500',{exact:true}).fill('2');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Confirm & Start Shift'}).click();
 await expect.poll(()=>calls.some(c=>c.name==='open_cash_shift')).toBe(true);expect(calls.find(c=>c.name==='open_cash_shift')!.body.p_denominations).toEqual({'500':2});
});
test('closing sends denomination quantities rather than an editable expected amount',async({page})=>{
 const calls=await setup(page);await page.goto('/close-shift');await page.getByLabel('Closing cash count: quantity of ₹500',{exact:true}).fill('2');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Confirm Close'}).click();
 await expect(page.getByRole('heading',{name:'Shift Closed'})).toBeVisible();const call=calls.find(c=>c.name==='close_cash_shift')!;
 expect(call.body).toEqual({p_register_id:registerId,p_denominations:{'500':2}});
});
test('downloads bill CSV with separate cash and online columns',async({page})=>{
 await setup(page);await page.goto('/bills');await page.getByLabel('Export from date').fill('2026-09-12');await page.getByLabel('Export to date').fill('2026-09-12');
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export bill CSV'}).click();const download=await downloadPromise;
 const csv=await readFile((await download.path())!,'utf8');expect(csv).toContain('bill_number,bill_date,outlet');expect(csv).toContain('cash_paid,online_paid');expect(csv).toContain('00123,2026-09-12,Test outlet,walk_in,1000.00,300.00,700.00');
});
