vi.mock("../lib/reply-processing-lock",()=>({assertReplyProcessingOwnership:async()=>{},withReplyProcessingLock:async(_org:string,_id:string,fn:()=>Promise<unknown>)=>fn()}));
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query:vi.fn(),queryOne:vi.fn(),log:vi.fn(),fetch:vi.fn(),match:vi.fn(),record:vi.fn(),capture:vi.fn(),suppress:vi.fn() }));
vi.mock("../lib/db", () => ({query:m.query,queryOne:m.queryOne,transaction:vi.fn()}));
vi.mock("../lib/logger", () => ({logAgent:m.log}));
vi.mock("../lib/integrations/gmail", () => ({gmail:{isConnected:async()=>true,fetchReplies:m.fetch}}));
vi.mock("../lib/agents/org-fanout", () => ({orgsToSweep:async()=>({orgs:[{id:"tenant-a"}],pausedCount:0}),fanoutNote:()=>null}));
vi.mock("../lib/app-settings", () => ({areCallsEnabled:async()=>false}));
vi.mock("../lib/reply-capture", () => ({captureReply:m.capture,matchInboundReply:m.match}));
vi.mock("../lib/needs-matching", () => ({recordUnmatched:m.record}));
vi.mock("../lib/domain/reply-attachments", () => ({readReplyAttachments:async()=>({text:"",unreadable:[]}),combineReplyText:(body:string)=>body}));
vi.mock("../lib/domain/email-suppression", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/domain/email-suppression")>(), suppressEmail:m.suppress
}));
import { replyPoll } from "../lib/agents/maintenance";

const notice = {messageId:"dsn",threadId:"thread",from:"mailer-daemon@example.test",subject:"Delivery failure",body:"No delivery",snippet:"",references:[],attachments:[],deliveryReport:"Final-Recipient: rfc822; missing@example.test\nStatus: 5.1.1"};
describe("reply polling keeps durable progress", () => {
  beforeEach(()=>{
    vi.clearAllMocks();
    m.query.mockImplementation(async(sql:string)=>sql.includes("update integration_tokens")?[{org_id:"tenant-a"}]:[]);
    m.queryOne.mockImplementation(async(sql:string)=>sql.includes("reply_poll_after")?{connection_generation:"generation-a",after_sec:12345,page_token:null,scan_started_sec:null}:sql.includes("connection_generation")?{id:"tenant-a"}:null);
    m.log.mockResolvedValue(undefined);
    m.match.mockResolvedValue({comm:null,strongMatch:false});
    m.record.mockResolvedValue("saved-reply");
    m.fetch.mockResolvedValue({replies:[notice]});
  });
  it("saves an unmatched delivery notice, processes the next email, and advances the page", async()=>{
    m.fetch.mockResolvedValue({replies:[notice,{...notice,messageId:"reply",from:"sub@example.test",subject:"Quote",body:"Our price is $42000",deliveryReport:""}],truncated:true,nextPageToken:"next-page"});
    const result = await replyPoll.handler({});
    expect(result.ok).toBe(true);
    expect(result.humanActionRequired).toBe(true);
    expect(result.summary).toContain("unmatched delivery notices saved for review");
    expect(m.record).toHaveBeenCalledWith(expect.objectContaining({messageId:"reply",body:"Our price is $42000"}));
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({action:"bounce-unmatched",status:"skipped"}), {requirePersistence:true});
    expect(m.query.mock.calls.some(([sql,params])=>sql.includes("update integration_tokens")&&params.includes("next-page"))).toBe(true);
  });
  it("retains the cursor if the delivery notice cannot be durably recorded", async()=>{
    m.log.mockImplementation(async(entry)=>{if(entry.action==="bounce-unmatched") throw new Error("database write failed");});
    const result = await replyPoll.handler({});
    expect(result.ok).toBe(false);
    expect(m.query.mock.calls.some(([sql])=>sql.includes("update integration_tokens"))).toBe(false);
  });
  it("advances after a bounce discovered by the capture pipeline is saved", async()=>{
    m.fetch.mockResolvedValue({replies:[{...notice,from:"sub@example.test",subject:"Hello",body:"See attached",deliveryReport:""}],truncated:true,nextPageToken:"next-page"});
    m.match.mockResolvedValue({comm:{id:"outbound"},strongMatch:true});
    m.capture.mockResolvedValue({bounce:true});
    const result = await replyPoll.handler({});
    expect(result.ok).toBe(true);
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({action:"bounce-unmatched",input:expect.objectContaining({messageId:"dsn"})}), {requirePersistence:true});
    expect(m.query.mock.calls.some(([sql,params])=>sql.includes("update integration_tokens")&&params.includes("next-page"))).toBe(true);
  });
  it("does not skip a failed delivery-state write", async()=>{
    m.query.mockRejectedValue(new Error("write unavailable"));
    expect((await replyPoll.handler({})).ok).toBe(false);
    expect(m.query.mock.calls.some(([sql])=>sql.includes("update integration_tokens"))).toBe(false);
  });
  it("does not capture or advance after the mailbox connection changes during fetch", async () => {
    m.queryOne.mockImplementation(async(sql:string)=>sql.includes("reply_poll_after")?{connection_generation:"old",after_sec:12345,page_token:null,scan_started_sec:null}:null);
    const result = await replyPoll.handler({});
    expect(result.ok).toBe(false);
    expect(m.capture).not.toHaveBeenCalled();
    expect(m.record).not.toHaveBeenCalled();
    expect(m.query.mock.calls.some(([sql])=>sql.includes("update integration_tokens"))).toBe(false);
  });
  it("reports a lost cursor fence rather than claiming progress", async () => {
    m.fetch.mockResolvedValue({replies:[]});
    m.query.mockResolvedValue([]);
    expect((await replyPoll.handler({})).ok).toBe(false);
    const update = m.query.mock.calls.find(([sql])=>sql.includes("update integration_tokens"));
    expect(update?.[0]).toContain("connection_generation=$3::uuid");
    expect(update?.[1]).toContain("generation-a");
  });
  it("suppresses a known contact's unmatched opt-out within its owning tenant", async () => {
    const lookup = m.queryOne.getMockImplementation()!;
    m.queryOne.mockImplementation(async(sql, p)=>sql.includes("from subcontractors")?{id:"sub-a",company_name:"Known firm"}:lookup(sql,p));
    m.fetch.mockResolvedValue({replies:[{...notice,from:"sub@example.test",subject:"Please remove me",body:"Please remove me from your list",deliveryReport:""}]});
    expect((await replyPoll.handler({})).ok).toBe(true);
    expect(m.suppress).toHaveBeenCalledWith(expect.objectContaining({orgId:"tenant-a",email:"sub@example.test",source:"reply"}));
    expect(m.record).toHaveBeenCalled();
  });
  it("retains progress when unmatched persistence fails", async () => {
    m.fetch.mockResolvedValue({replies:[{...notice,from:"sub@example.test",subject:"Quote",body:"A reply",deliveryReport:""}]});
    m.record.mockRejectedValue(new Error("database unavailable"));
    expect((await replyPoll.handler({})).ok).toBe(false);
    expect(m.query.mock.calls.some(([sql])=>sql.includes("update integration_tokens"))).toBe(false);
  });

  it("fences against raw historical cursor values while reading a normalized scan range", async () => {
    m.queryOne.mockImplementation(async(sql:string)=>sql.includes("reply_poll_after")?{
      connection_generation:"generation-a",raw_after:"0012345",raw_page_token:"",after_sec:12345,page_token:null,scan_started_sec:null
    }:sql.includes("connection_generation")?{id:"tenant-a"}:null);
    m.fetch.mockResolvedValue({replies:[]});
    expect((await replyPoll.handler({})).ok).toBe(true);
    const update = m.query.mock.calls.find(([sql])=>sql.includes("update integration_tokens"));
    expect(update?.[1]).toEqual(["tenant-a",expect.any(Number),"generation-a","","0012345"]);
    expect(m.fetch.mock.calls[0][0]).toBe(12345);
  });

});
