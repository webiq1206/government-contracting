import {beforeAll,afterAll,beforeEach,it,expect,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
const state=vi.hoisted(()=>({db:null as PGlite|null,enqueue:vi.fn()}));
vi.mock("../lib/db",()=>({query:async(sql:string,p:unknown[]=[]) => (await state.db!.query(sql,p)).rows,
 queryOne:async(sql:string,p:unknown[]=[]) => (await state.db!.query(sql,p)).rows[0]??null}));
vi.mock("../lib/logger",()=>({logAgent:async()=>undefined}));
vi.mock("../lib/work-mode",()=>({opportunityWorkMode:async()=>null}));
vi.mock("../lib/queue",()=>({enqueue:state.enqueue}));
import {closeIfSubsExhausted} from "../lib/domain/advance-stage";
import {claimSubSearchIntent,markSubSearchQueued,completeSubSearchIntent,recoverRequestedSubSearches} from "../lib/sub-search-intents";
let org:string,opp:string;
beforeAll(async()=>{state.db=new PGlite();await state.db.exec(`
 create table organizations(id uuid primary key);
 create table opportunities(id uuid primary key,org_id uuid,status text,stage text,pursuit_state text,pursuit_version integer,risk_flags text[],human_action_required boolean,updated_at timestamptz);
 create table opportunity_subs(opportunity_id uuid,trade text,outreach_state text);
 create table quotes(opportunity_id uuid,trade text,quote_amount numeric);
 create table subcontractor_reply_events(opportunity_id uuid,needs_review boolean,reviewed_at timestamptz);`);
 await state.db.exec(readFileSync("db/migrations/129_sub_search_intents.sql","utf8"));},60000);
afterAll(async()=>{await state.db?.close();});
beforeEach(async()=>{org=randomUUID();opp=randomUUID();state.enqueue.mockReset();
 await state.db!.query("insert into organizations values($1)",[org]);
 await state.db!.query("insert into opportunities values($1,$2,'open','quote_entry','active',1,'{}',false,now())",[opp,org]);
 await state.db!.query("insert into opportunity_subs values($1,'HVAC','declined')",[opp]);
});
it("survives failed downstream enqueue and replay without premature archive",async()=>{
 const first=await closeIfSubsExhausted(opp);expect(first.action).toBe("resourced");
 state.enqueue.mockRejectedValueOnce(Error("queue unavailable before admission"));
 await expect(recoverRequestedSubSearches(org)).rejects.toThrow("queue unavailable");
 const replay=await closeIfSubsExhausted(opp);expect(replay.action).toBe("resourced");expect(replay.enqueue).toEqual(first.enqueue);
 const id=first.enqueue!.opts!.subSearchIntentId as string;
 expect(await claimSubSearchIntent(id,org,opp,1)).toBeTruthy();
 expect(await claimSubSearchIntent(id,org,opp,1)).toBeNull();
 expect((await closeIfSubsExhausted(opp)).action).toBe("none");
 await markSubSearchQueued(id,org,"queue-receipt");expect((await closeIfSubsExhausted(opp)).action).toBe("none");
 await completeSubSearchIntent(id,org,opp,1);expect((await closeIfSubsExhausted(opp)).action).toBe("closed");
});
it("holds ambiguous dispatch indefinitely and isolates tenant and generation",async()=>{
 const job=await closeIfSubsExhausted(opp);const id=job.enqueue!.opts!.subSearchIntentId as string;
 expect(await claimSubSearchIntent(id,randomUUID(),opp,1)).toBeNull();expect(await claimSubSearchIntent(id,org,opp,2)).toBeNull();
 await claimSubSearchIntent(id,org,opp,1);await state.db!.query("update sub_search_intents set created_at=now()-interval '90 days' where id=$1",[id]);
 await recoverRequestedSubSearches(org);expect(state.enqueue).not.toHaveBeenCalled();
 await completeSubSearchIntent(id,randomUUID(),opp,1);expect((await closeIfSubsExhausted(opp)).action).toBe("none");
});
it("does not treat a historical used flag as proof of completed work",async()=>{
 await state.db!.query("update opportunities set risk_flags=array['sub_search_retried'] where id=$1",[opp]);
 expect((await closeIfSubsExhausted(opp)).action).toBe("none");expect((await state.db!.query("select status from opportunities where id=$1",[opp])).rows[0].status).toBe("open");
});
