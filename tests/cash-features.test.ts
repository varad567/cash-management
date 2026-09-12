import { describe,it,expect,vi,beforeEach } from 'vitest';
import { denominationTotal,validateSplit,businessDate } from '../src/lib/cashDenominations';
import { buildCsv } from '../src/lib/csvExport';
const { from } = vi.hoisted(()=>({from:vi.fn()}));
vi.mock('../src/lib/supabaseClient',()=>({supabase:{from}}));
import { getBillsForExport,billCsvRow,type ReconciliationBill } from '../src/lib/billExportService';
beforeEach(()=>vi.clearAllMocks());
describe('denominations and split payments',()=>{
 it('adds mixed notes and coins exactly',()=>expect(denominationTotal({'500':2,'20':3,'2':4,'0.5':3})).toBe(1069.5));
 it.each([{'500':-1},{'500':1.5},{'500':1000001},{'7':1},{'500':NaN}])('rejects invalid counts %j',(counts)=>expect(()=>denominationTotal(counts)).toThrow());
 it('allows explicit zero and same-value alternative denominations',()=>{expect(denominationTotal({'1':0})).toBe(0);expect(denominationTotal({'200':5})).toBe(denominationTotal({'500':2}));});
 it('validates cash-only, online-only and split tender',()=>{expect(()=>validateSplit(100,100,0,true,'')).not.toThrow();expect(()=>validateSplit(100,0,100,true,'UPI')).not.toThrow();expect(()=>validateSplit(0.3,0.1,0.2,true,'UPI')).not.toThrow();});
 it.each([[100,30,60,true,'UPI'],[100,100,1,true,'UPI'],[100,30,70,true,''],[100,1.001,0,false,''],[100,-1,0,false,'']])('rejects invalid payment %j',(...args)=>expect(()=>validateSplit(...args as [number,number,number,boolean,string])).toThrow());
 it('uses Indian business dates across UTC midnight',()=>expect(businessDate(new Date('2026-09-11T20:00:00Z'))).toBe('2026-09-12'));
});
describe('bill CSV',()=>{
 it('escapes quoted text, newlines and spreadsheet formulas, preserving ordinary serials',()=>{
  const csv=buildCsv([{bill_number:'00123',text:'a,"b"\r\nc',unsafe:' =HYPERLINK("bad")',amount:-5}]);
  expect(csv).toContain('00123');expect(csv).toContain('"a,""b""\r\nc"');expect(csv).toContain("' =HYPERLINK");expect(csv).toContain(',-5');expect(csv.startsWith('\uFEFF')).toBe(true);
 });
 it('exports every page rather than the 30 visible rows',async()=>{
  const page=(offset:number,n:number)=>Array.from({length:n},(_,i)=>({id:String(offset+i).padStart(6,'0'),register_date:'2026-09-12',bill_serial:String(offset+i)}));
  const pages=[page(0,500),page(500,500),page(1000,17),[]];
  const gt=vi.fn();
  from.mockImplementation(()=>{const q:any={select:()=>q,gte:()=>q,lte:()=>q,order:()=>q,limit:()=>q,eq:()=>q,ilike:()=>q,gt:(...args:any[])=>{gt(...args);return q;},then:(resolve:any)=>resolve({data:pages.shift(),error:null})};return q;});
  const rows=await getBillsForExport({from:'2026-09-12',to:'2026-09-12'});
  expect(rows).toHaveLength(1017);expect(new Set(rows.map(r=>r.id)).size).toBe(1017);expect(gt).toHaveBeenCalledWith('id','000499');expect(from).toHaveBeenCalledTimes(4);
 });
 it('surfaces paging errors instead of downloading an incomplete file',async()=>{
  from.mockImplementation(()=>{const q:any={select:()=>q,gte:()=>q,lte:()=>q,order:()=>q,limit:()=>q,then:(resolve:any)=>resolve({data:null,error:new Error('Unavailable')})};return q;});
  await expect(getBillsForExport({from:'2026-09-12',to:'2026-09-12'})).rejects.toThrow('Unavailable');
 });
 it('keeps bill totals, tender totals, returns, and differences separate',()=>{
  const row=billCsvRow({id:'b',outlet_id:'o',outlet_name:'Outlet',bill_serial:'001',register_date:'2026-09-12',bill_amount:100,cash_paid:30,online_paid:70,credit_applied:0,amount_paid:100,payment_total:100,balance_due:0,returned_amount:10,ledger_difference:0,status:'paid',bill_type:'walk_in',online_references:'UPI',created_at:''} as ReconciliationBill,'now');
  expect(row).toMatchObject({bill_number:'001',cash_paid:'30.00',online_paid:'70.00',total_paid:'100.00',returned_amount:'10.00'});
 });
});
