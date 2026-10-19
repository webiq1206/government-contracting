import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { currentOrgId, runWithOrg } from "../lib/tenant-context";
import { withApiUsageContext } from "../lib/api-usage/context";
vi.mock("../lib/tenant",()=>({ resolveTenantOrgId:async()=>currentOrgId()! }));
import { withAiWorkReceipt } from "../lib/ai/work-receipts";
const live=!!process.env.DATABASE_URL && !!process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
(live ? describe : describe.skip)("real PostgreSQL failover receipt admission",()=>{
 let query:typeof import("../lib/db").query;
 const org=randomUUID();
 const run=(workKey:string,input:unknown,execute:()=>Promise<unknown>,enabled=true)=>runWithOrg(org,()=>withApiUsageContext({workKey},()=>
   withAiWorkReceipt({route:"legacy",input},execute,{logicalInput:input,enableProviderIndependent:enabled})));
 beforeAll(async()=>{
  ({query}=await import("../lib/db"));
  await query("insert into organizations(id,name,subscription_status,billing_exempt) values($1,'Synthetic failover locks','active',true)",[org]);
 });
 afterAll(async()=>{await query("delete from ai_work_receipts where org_id=$1",[org]);await query("delete from organizations where id=$1",[org]);});
 it("commits pending before I/O and fences a second worker with a changed work key",async()=>{
  let entered!:()=>void;let release!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});const waiting=new Promise<void>(resolve=>{release=resolve;});
  const execute=vi.fn(async()=>{entered();await waiting;return "saved output";});
  const first=run("cron","message-a",execute);await started;
  try {
   await expect(run("manual","message-a",execute)).rejects.toThrow("has not settled");
   expect(execute).toHaveBeenCalledOnce();
   expect((await query("select state from ai_work_receipts where org_id=$1",[org]))[0]).toMatchObject({state:"pending"});
  }finally{release();}
  await first;
  expect(await run("cron","message-a",execute,false)).toBe("saved output");
  expect(execute).toHaveBeenCalledOnce();
 });
 it("waits for a flag-off legacy execution while it is active, and leaves its saved output alone after it completes",async()=>{
  await query("delete from ai_work_receipts where org_id=$1",[org]);
  let entered!:()=>void;let release!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});const waiting=new Promise<void>(resolve=>{release=resolve;});
  const first=run("legacy","message-b",async()=>{entered();await waiting;return "legacy output";},false);await started;
  const execute=vi.fn(async()=>"new output");
  try {await expect(run("new","message-b",execute)).rejects.toThrow("earlier work receipt is still inside its lease");}finally{release();}
  await first;
  expect(execute).not.toHaveBeenCalled();
  // A completed legacy row is a saved answer under a key nothing reads any
  // more. It does not hold the tenant; the new identity runs its work once.
  expect(await run("new","message-b",execute)).toBe("new output");
  expect(execute).toHaveBeenCalledOnce();
  const rows=await query<{scope_key:string;state:string;result:unknown}>("select scope_key,state,result from ai_work_receipts where org_id=$1 order by scope_key",[org]);
  expect(rows.find(r=>!r.scope_key.startsWith("v2:"))).toMatchObject({state:"complete",result:"legacy output"});
  expect(rows.find(r=>r.scope_key.startsWith("v2:"))).toMatchObject({state:"complete",result:"new output"});
 });
});
