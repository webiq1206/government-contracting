import {EventEmitter} from "node:events";
import {describe,it,expect,vi} from "vitest";
const state=vi.hoisted(()=>({clients:[] as any[]}));
vi.mock("../lib/db",()=>({standaloneClient:()=>{const c=new EventEmitter() as any;c.connect=async()=>{};c.end=async()=>{};c.query=async(sql:string)=>({rows:sql.includes("pg_try_advisory")?[{acquired:true}]:[]});state.clients.push(c);return c;}}));
import {withReplyProcessingLock,assertReplyProcessingOwnership} from "../lib/reply-processing-lock";
describe("reply session ownership loss",()=>{
 it("prevents effects after the lock connection drops during awaited extraction",async()=>{
  let release!:()=>void,entered!:()=>void,writes=0;
  const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
  const first=withReplyProcessingLock("org","message",async()=>{entered();await wait;await assertReplyProcessingOwnership();writes++;}).catch(e=>e);
  await ready;state.clients[0].emit("error",Error("connection lost"));
  await withReplyProcessingLock("org","message",async()=>{await assertReplyProcessingOwnership();writes++;});
  release();expect(await first).toBeInstanceOf(Error);expect(writes).toBe(1);
 });
});
