import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query:vi.fn(),queryOne:vi.fn(),log:vi.fn(),fetch:vi.fn(),match:vi.fn(),record:vi.fn(),capture:vi.fn() }));
vi.mock("../lib/db", () => ({query:m.query,queryOne:m.queryOne,transaction:vi.fn()}));
vi.mock("../lib/logger", () => ({logAgent:m.log}));
vi.mock("../lib/integrations/gmail", () => ({gmail:{isConnected:async()=>true,fetchReplies:m.fetch}}));
vi.mock("../lib/agents/org-fanout", () => ({orgsToSweep:async()=>({orgs:[{id:"tenant-a"}],pausedCount:0}),fanoutNote:()=>null}));
vi.mock("../lib/app-settings", () => ({areCallsEnabled:async()=>false}));
vi.mock("../lib/reply-capture", () => ({captureReply:m.capture,matchInboundReply:m.match}));
vi.mock("../lib/needs-matching", () => ({recordUnmatched:m.record}));
vi.mock("../lib/domain/reply-attachments", () => ({readReplyAttachments:async()=>({text:"",unreadable:[]}),combineReplyText:(body:string)=>body}));
import { replyPoll } from "../lib/agents/maintenance";

const notice = {messageId:"dsn",threadId:"thread",from:"mailer-daemon@example.test",subject:"Delivery failure",body:"No delivery",snippet:"",references:[],attachments:[],deliveryReport:"Final-Recipient: rfc822; missing@example.test\nStatus: 5.1.1"};
describe("reply polling keeps durable progress", () => {
  beforeEach(()=>{
    vi.clearAllMocks();
    m.query.mockResolvedValue([]);
    m.queryOne.mockImplementation(async(sql:string)=>sql.includes("reply_poll_after")?{after_sec:12345,page_token:null,scan_started_sec:null}:null);
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
});
