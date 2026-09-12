import { describe,it,expect,vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
function handler(file: string, client: unknown, fetchMock: unknown) {
  let serve!: (r:Request)=>Promise<Response>;
  const source=readFileSync(file,'utf8').replace("import { createClient } from 'jsr:@supabase/supabase-js@2';",'');
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  runInNewContext(js,{createClient:()=>client,fetch:fetchMock,Request,Response,console:{error:vi.fn()},Deno:{env:{get:(k:string)=>k==='ALERT_SHARED_SECRET'?'test-secret':'synthetic'},serve:(fn:typeof serve)=>{serve=fn;}}});
  return serve;
}
function notificationMock() {
 const state={notified:false,sent:false,lastError:'',deliveries:new Set<string>(),acceptedWrites:0};
 const client={from:(table:string)=>{
   let update:any;const filters:Record<string,unknown>={};let insert:any;
   const result=()=>{
    if(table==='alert_recipients')return {data:[{email:'owner@example.invalid'}],error:null};
    if(table==='notification_deliveries'){
      if(insert){state.deliveries.add(insert.recipient);state.acceptedWrites++;return {error:null};}
      return {data:state.deliveries.has(filters.recipient as string)?{recipient:filters.recipient}:null,error:null};
    }
    if(update){if(table==='notification_outbox'){if(update.status==='sent')state.sent=true;if(update.last_error)state.lastError=update.last_error;}if(table==='sync_failures')state.notified=update.notified;}
    return {data:null,error:null};
   };
   const q:any={select:()=>q,eq:(key:string,val:unknown)=>{filters[key]=val;return q;},update:(v:any)=>{update=v;return q;},upsert:(v:any)=>{insert=v;return q;},maybeSingle:async()=>result(),then:(resolve:any)=>resolve(result())};return q;
 }};
 return {state,client};
}
const request=()=>new Request('https://example.invalid',{method:'POST',headers:{'x-alert-secret':'test-secret','Content-Type':'application/json'},body:JSON.stringify({type:'sync_failure',_notification_id:'notification-1',failure_id:'failure-1',table_name:'payments',error_message:'Synthetic error'})});
describe('Edge Functions',()=>{
 it('does not acknowledge a provider rejection, then recovers without duplicate deliveries',async()=>{
  const {state,client}=notificationMock();const fetchMock=vi.fn().mockResolvedValueOnce(new Response('rate limited',{status:429})).mockResolvedValue(new Response('{}',{status:200}));
  const serve=handler('supabase/functions/send-alert/index.ts',client,fetchMock);
  expect((await serve(request())).status).toBe(500);expect(state.sent).toBe(false);expect(state.notified).toBe(false);expect(state.lastError).toContain('429');
  expect((await serve(request())).status).toBe(200);expect(state.sent).toBe(true);expect(state.notified).toBe(true);expect(state.acceptedWrites).toBe(1);
  expect((await serve(request())).status).toBe(200);expect(fetchMock).toHaveBeenCalledTimes(2);expect(fetchMock.mock.calls[1][1].headers['Idempotency-Key']).toBe('notification-1:owner@example.invalid');
 });
 it('rejects alerts without the shared secret',async()=>{
  const fetchMock=vi.fn();const serve=handler('supabase/functions/send-alert/index.ts',{},fetchMock);
  expect((await serve(new Request('https://example.invalid',{method:'POST'}))).status).toBe(401);expect(fetchMock).not.toHaveBeenCalled();
 });
 it.each(['supabase/functions/create-user/index.ts','supabase/functions/reset-user-password/index.ts'])('blocks an inactive HQ session in %s',async(file)=>{
  const createUser=vi.fn(),generateLink=vi.fn();
  const client={auth:{getUser:async()=>({data:{user:{id:'hq'}}}),admin:{createUser,generateLink}},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role:'hq',is_active:false}})})})})};
  const serve=handler(file,client,vi.fn());const r=await serve(new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:'{}'}));
  expect(r.status).toBe(403);expect(createUser).not.toHaveBeenCalled();expect(generateLink).not.toHaveBeenCalled();
 });
});
