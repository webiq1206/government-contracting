import {beforeEach,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({send:vi.fn(),claim:vi.fn(),queued:vi.fn(),release:vi.fn(),paused:false}));
vi.mock("../lib/queue/pgboss",()=>({createPgBossQueue:async()=>({start:async()=>{},stop:async()=>{},enqueue:m.send})}));
vi.mock("../lib/app-settings",()=>({isPlatformAutomationPaused:async()=>m.paused,isAutomationPaused:async()=>false}));
vi.mock("../lib/queue/ai-admission",()=>({aiEnqueueHold:async()=>null}));
vi.mock("../lib/pursuit-guard",()=>({pursuitStatus:async()=>({mayAct:true,known:true,version:1})}));
vi.mock("../lib/work-mode",()=>({opportunityOutreachAllowed:async()=>true}));
vi.mock("../lib/sub-search-intents",()=>({SUB_SEARCH_INTENT_KEY:"subSearchIntentId",claimSubSearchIntent:m.claim,markSubSearchQueued:m.queued,releaseUnqueuedSubSearch:m.release}));
import {enqueue,resetQueue} from "../lib/queue";
const opts={orgId:"org",subSearchIntentId:"intent"};
beforeEach(async()=>{await resetQueue();vi.clearAllMocks();m.paused=false;m.claim.mockResolvedValue({id:"intent"});m.send.mockResolvedValue("job");});
it("releases confirmed null admission but retains an uncertain handoff",async()=>{
 m.send.mockResolvedValueOnce(null);expect(await enqueue("sub-finder",{opportunityId:"opp"},opts)).toBeNull();expect(m.release).toHaveBeenCalledWith("intent","org");
 m.release.mockClear();m.send.mockRejectedValueOnce(Error("lost queue ACK"));await expect(enqueue("sub-finder",{opportunityId:"opp"},opts)).rejects.toThrow();expect(m.release).not.toHaveBeenCalled();
});
it("does not claim while paused and strips caller-forged intent identity",async()=>{
 m.paused=true;await enqueue("sub-finder",{opportunityId:"opp"},opts);expect(m.claim).not.toHaveBeenCalled();
 m.paused=false;await enqueue("sub-finder",{opportunityId:"opp",subSearchIntentId:"forged"},{orgId:"org"});
 expect(m.send.mock.calls[0][1]).not.toHaveProperty("subSearchIntentId");expect(m.claim).not.toHaveBeenCalled();
});
it("passes only a claimed queue-owned intent and records its admission",async()=>{
 await enqueue("sub-finder",{opportunityId:"opp",subSearchIntentId:"forged"},opts);
 expect(m.send.mock.calls[0][1].subSearchIntentId).toBe("intent");expect(m.queued).toHaveBeenCalledWith("intent","org","job");
});
