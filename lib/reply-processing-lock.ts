import { AsyncLocalStorage } from "node:async_hooks";
import { standaloneClient } from "./db";
const ownership = new AsyncLocalStorage<Array<()=>Promise<void>>>();
export async function assertReplyProcessingOwnership():Promise<void>{
  for(const check of ownership.getStore() ?? []) await check();
}
/** Session-owned transaction lock: process death releases it, never a timer.
 * A separate connection avoids starving the shared query/provider pool. */
export async function withReplyProcessingLock<T>(orgId:string,messageId:string,execute:()=>Promise<T>):Promise<T>{
  const client=standaloneClient({queryTimeoutMs:5000,applicationName:"brostco-reply-processing"});
  let connectionError:Error|null=null;
  client.on("error",error=>{connectionError=error;});
  try{
    await client.connect();await client.query("begin");
    const lock=await client.query("select pg_try_advisory_xact_lock(hashtextextended($1,0)) as acquired",[JSON.stringify(["reply-effects",orgId,messageId])]);
    if(!lock.rows[0]?.acquired) throw new Error("Reply processing is already active; retry this mailbox page after it completes.");
    const check=async()=>{
      if(connectionError)throw connectionError;
      await client.query("select 1");
      if(connectionError)throw connectionError;
    };
    const result=await ownership.run([...(ownership.getStore() ?? []),check],execute);
    if(connectionError)throw connectionError;
    await client.query("commit");return result;
  }finally{await client.end().catch(()=>undefined);}
}
