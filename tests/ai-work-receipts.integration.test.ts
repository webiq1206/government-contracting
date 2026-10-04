import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {randomUUID} from "node:crypto";
const state=vi.hoisted(()=>({db:null as PGlite|null,org:"",lost:false}));
vi.mock("../lib/db",()=>({transaction:async(fn:any)=>state.db!.transaction((tx:any)=>fn({query:async(sql:string,p:unknown[])=>sql.includes("pg_try_advisory_xact_lock")?{rows:[{acquired:true}]}:tx.query(sql,p)})),queryOne:async(sql:string,p:unknown[])=>{
 const row=(await state.db!.query(sql,p)).rows[0]??null;
 if(state.lost && sql.includes("state='complete'"))throw Error("receipt ACK lost");return row;
}}));
vi.mock("../lib/tenant",()=>({resolveTenantOrgId:async()=>state.org}));
import {withAiWorkReceipt} from "../lib/ai/work-receipts";
import {withApiUsageContext} from "../lib/api-usage/context";
const run=<T,>(key:string,input:unknown,fn:()=>Promise<T>)=>withApiUsageContext({workKey:key,relatedId:"record"},()=>withAiWorkReceipt(input,fn));
beforeAll(async()=>{state.db=new PGlite();await state.db.exec(`create table ai_work_receipts(org_id uuid,work_key text,scope_key text,input_hash text,owner uuid,state text,result jsonb,started_at timestamptz,completed_at timestamptz,primary key(org_id,work_key));`);},60000);
afterAll(async()=>{await state.db?.close();});beforeEach(()=>{state.org=randomUUID();state.lost=false;});
describe("AI work reconciliation across recovery sweeps",()=>{
 it("blocks paid replay after provider settlement committed but its acknowledgement/output was lost",async()=>{
  const execute=vi.fn(async()=>{throw Object.assign(Error("Provider completion needs reconciliation"),{retryable:false,provider:"OpenAI"});});
  await expect(run("score:record",{prompt:"scope"},execute)).rejects.toMatchObject({retryable:false});
  for(let n=0;n<3;n++)await expect(run("score:record",{prompt:"scope"},execute)).rejects.toMatchObject({retryable:false});
  expect(execute).toHaveBeenCalledTimes(1);
 });
 it("returns a committed output after losing the work-receipt ACK without another provider call",async()=>{
  const execute=vi.fn(async()=>({text:"saved output"}));state.lost=true;
  await expect(run("score:record",{prompt:"scope"},execute)).rejects.toMatchObject({retryable:false});state.lost=false;
  expect(await run("score:record",{prompt:"scope"},execute)).toEqual({text:"saved output"});expect(execute).toHaveBeenCalledTimes(1);
 });
 it("does not use changed input to bypass an unresolved logical work item",async()=>{
  await expect(run("score:record","old",async()=>{throw Error("crashed");})).rejects.toThrow();
  const execute=vi.fn(async()=>"new");await expect(run("score:record","new",execute)).rejects.toMatchObject({retryable:false});expect(execute).not.toHaveBeenCalled();
 });
 it("serializes concurrent duplicate work and isolates tenants and explicit work generations",async()=>{
  const execute=vi.fn(async()=>"result");await Promise.allSettled([run("work:v1","input",execute),run("work:v1","input",execute)]);expect(execute).toHaveBeenCalledTimes(1);
  await run("work:v2","input",execute);state.org=randomUUID();await run("work:v1","input",execute);expect(execute).toHaveBeenCalledTimes(3);
 });
 it("preserves transient refusal backoff and spending holds",async()=>{
  const execute=vi.fn().mockRejectedValueOnce(Object.assign(Error("rate limit"),{name:"AiUnavailableError",provider:"OpenAI",reason:"rate limit",status:429,retryable:true})).mockResolvedValue("recovered");
  await expect(run("work","input",execute)).rejects.toMatchObject({retryable:true});expect(await run("work","input",execute)).toBe("recovered");
  await expect(run("held","input",async()=>{throw Object.assign(Error("budget"),{name:"ApiUsageBlockedError"});})).rejects.toThrow("budget");
  expect(await run("held","input",async()=>"allowed")).toBe("allowed");
 });
});

 it("does not reopen ambiguous transport errors",async()=>{
  const execute=vi.fn(async()=>{throw Object.assign(Error("timeout"),{name:"AiUnavailableError",reason:"timeout",retryable:true});});
  await expect(run("uncertain","input",execute)).rejects.toMatchObject({retryable:false});
  await expect(run("uncertain","input",execute)).rejects.toMatchObject({retryable:false});expect(execute).toHaveBeenCalledTimes(1);
 });
 it("handles successive mailbox messages and partial record resumes without ordinal collisions",async()=>{
  const execute=vi.fn(async()=>"result");
  const sweep=(input:string)=>withApiUsageContext({workKey:"reply-poll"},()=>withAiWorkReceipt(input,execute));
  await sweep("message-a");await sweep("message-b");expect(execute).toHaveBeenCalledTimes(2);
  await run("bid:record","step-a",execute);await run("bid:record","step-b",execute);
  await run("bid:record","step-b",execute);expect(execute).toHaveBeenCalledTimes(4);
 });

it("normalizes UUID spellings before unresolved-work scope lookup",async()=>{
 const {agentWorkIdentity}=await import("../lib/ai/work-identity");
 const id="abcabcab-1234-4234-a234-abcdefabcdef";
 const invoke=(opportunityId:string)=>withApiUsageContext(agentWorkIdentity("scoring-engine",{opportunityId},1),()=>withAiWorkReceipt("prompt",execute));
 const execute=vi.fn(async()=>{throw Error("lost result");});
 await expect(invoke(id)).rejects.toThrow();await expect(invoke(id.toUpperCase())).rejects.toThrow();
 await expect(invoke(`{${id}}`)).rejects.toThrow();await expect(invoke(id.replace(/-/g,""))).rejects.toThrow();
 expect(execute).toHaveBeenCalledTimes(1);
});
