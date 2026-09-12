import { beforeEach,describe,it,expect,vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
const mock=vi.hoisted(()=>({rpc:vi.fn(),insert:vi.fn(),getSession:vi.fn()}));
vi.mock('../src/lib/supabaseClient',()=>({supabase:{rpc:mock.rpc,auth:{getSession:mock.getSession},from:()=>({insert:mock.insert})}}));
import { queueAction,syncPendingActions,setCashContext,getPendingCount,getFailedActions,getUnresolvedCount } from '../src/lib/offlineQueue';
beforeEach(()=>{
 vi.clearAllMocks();vi.stubGlobal('indexedDB',new IDBFactory());vi.stubGlobal('navigator',{onLine:false});
 const store=new Map();vi.stubGlobal('localStorage',{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v)});
 mock.getSession.mockResolvedValue({data:{session:{user:{id:'cashier'}}}});mock.insert.mockResolvedValue({error:null});
 setCashContext({actorId:'cashier',outletId:'outlet',registerId:'original-shift'});
});
describe('offline queue integrity',()=>{
 it('reuses the same server operation ID after a committed response is lost',async()=>{
   const committed=new Set();mock.rpc.mockImplementation(async(_name,args)=>{const prior=committed.has(args.p_operation_id);committed.add(args.p_operation_id);return prior?{error:null}:{error:{message:'Lost response'}};});
   await queueAction('payments','insert',{outlet_id:'outlet',amount:100,mode:'cash'});
   await syncPendingActions();expect(await getPendingCount()).toBe(1);await syncPendingActions();
   expect(mock.rpc.mock.calls[0][1]).toEqual(mock.rpc.mock.calls[1][1]);expect(committed.size).toBe(1);expect(await getPendingCount()).toBe(0);
 });
 it('never replays another cashier’s entries after account switch',async()=>{
   await queueAction('payments','insert',{outlet_id:'outlet',amount:100});setCashContext({actorId:'other',outletId:'outlet',registerId:'other-shift'});
   mock.getSession.mockResolvedValue({data:{session:{user:{id:'other'}}}});await syncPendingActions();expect(mock.rpc).not.toHaveBeenCalled();
   setCashContext({actorId:'cashier',outletId:'outlet',registerId:'original-shift'});expect(await getPendingCount()).toBe(1);
 });
 it('preserves the original register when a newer shift is open',async()=>{
   await queueAction('payments','insert',{outlet_id:'outlet',amount:100});setCashContext({actorId:'cashier',outletId:'outlet',registerId:'new-shift'});
   mock.rpc.mockResolvedValue({error:{code:'P0001',message:'Original shift is no longer open'}});await syncPendingActions();
   expect(mock.rpc.mock.calls[0][1].p_register_id).toBe('original-shift');expect(await getFailedActions()).toHaveLength(1);expect(await getUnresolvedCount('original-shift')).toBe(1);
 });
 it('keeps failed diagnostics for retry when logging fails',async()=>{
   await queueAction('payments','insert',{outlet_id:'outlet',amount:100});mock.rpc.mockResolvedValue({error:{code:'P0001',message:'Rejected'}});
   await syncPendingActions();mock.insert.mockResolvedValueOnce({error:{message:'offline'}});await syncPendingActions();expect((await getFailedActions())[0].failure_reported).not.toBe(true);
   await syncPendingActions();expect((await getFailedActions())[0].failure_reported).toBe(true);expect(await getUnresolvedCount('original-shift')).toBe(1);
 });
 it('stops dependent replay after a transient failure',async()=>{
   await queueAction('bills','insert',{outlet_id:'outlet',id:'bill'});await queueAction('payments','insert',{outlet_id:'outlet',bill_id:'bill'});
   mock.rpc.mockResolvedValue({error:{message:'Network down'}});await syncPendingActions();expect(mock.rpc).toHaveBeenCalledTimes(1);expect(await getPendingCount()).toBe(2);
 });
});
