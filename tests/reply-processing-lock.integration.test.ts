import {describe,it,expect,afterAll} from "vitest";
import {randomUUID} from "node:crypto";
import {withReplyProcessingLock} from "../lib/reply-processing-lock";
import {closePool,query} from "../lib/db";
const suite=process.env.DATABASE_URL?describe:describe.skip;
suite("reply effects ownership",()=>{
 afterAll(async()=>{await closePool();});
 it("serializes concurrent resumes, releases on interruption, and leaves the shared pool usable",async()=>{
  const org=randomUUID(),message=randomUUID();let entered!:()=>void,release!:()=>void,calls=0;
  const started=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
  const first=withReplyProcessingLock(org,message,async()=>{calls++;await query("select 1");entered();await wait;throw Error("interrupted");}).catch(e=>e);
  await started;
  try{await expect(withReplyProcessingLock(org,message,async()=>{calls++;})).rejects.toThrow("already active");}
  finally{release();}
  expect(await first).toBeInstanceOf(Error);
  await withReplyProcessingLock(org,message,async()=>{calls++;});expect(calls).toBe(2);
 });
});
