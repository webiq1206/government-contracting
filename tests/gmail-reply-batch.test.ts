import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), thread:vi.fn() }));
vi.mock("../lib/config", () => ({ config: { gmail: { configured: true } } }));
vi.mock("../lib/db", () => ({ query: async () => [], queryOne: async () => ({ data: { refresh_token: "test-refresh" } }) }));
vi.mock("googleapis", () => ({ google: {
  auth: { OAuth2: class { setCredentials() {} } },
  gmail: () => ({ users: { messages: { list: mocks.list, get: mocks.get }, threads:{get:mocks.thread} } }),
} }));
vi.mock("../lib/integrations/gmail-quota", () => ({ reserveGmailQuota: vi.fn(async (_org: string, units: number) => units) }));
import { gmail } from "../lib/integrations/gmail";
import { reserveGmailQuota } from "../lib/integrations/gmail-quota";
describe("bounded Gmail reply reads", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.get.mockImplementation(async ({ id }) => ({ data: { id, payload: {} } })); });
  it("returns a complete bounded page and a continuation without spending quota on the next page", async () => {
    mocks.list.mockResolvedValue({ data: { messages: Array.from({ length: 100 }, (_, i) => ({ id: `mail-${i}` })), nextPageToken: "older-page" } });
    const result = await gmail.fetchReplies(12345, "tenant-a");
    expect(result.replies).toHaveLength(100);
    expect(result).toMatchObject({ truncated: true, nextPageToken: "older-page" });
    expect(mocks.get).toHaveBeenCalledTimes(100);
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });
  it("keeps completed reads and resumes at the interrupted message after a quota failure", async () => {
    mocks.list.mockResolvedValue({ data: { messages: [{ id: "one" }, { id: "two" }, { id: "three" }], nextPageToken: "older" } });
    mocks.get.mockImplementation(async ({ id }) => {
      if (id === "two") throw new Error("Quota exceeded");
      return { data: { id, payload: {} } };
    });
    const partial = await gmail.fetchReplies(12345, "tenant-a");
    expect(partial.replies.map(r => r.messageId)).toEqual(["one"]);
    expect(partial.partialError).toBe("Quota exceeded");
    mocks.get.mockImplementation(async ({ id }) => ({ data: { id, payload: {} } }));
    const rest = await gmail.fetchReplies(12345, "tenant-a", { pageToken: partial.nextPageToken });
    expect(rest.replies.map(r => r.messageId)).toEqual(["two", "three"]);
    expect(rest.nextPageToken).toBe("older");
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });
  it("moves past a message deleted after listing without losing the following reply", async () => {
    mocks.list.mockResolvedValue({ data: { messages: [{ id: "deleted" }, { id: "kept" }] } });
    mocks.get.mockImplementation(async ({ id }) => {
      if (id === "deleted") throw Object.assign(new Error("Not found"), { code: 404 });
      return { data: { id, payload: {} } };
    });
    expect((await gmail.fetchReplies(12345, "tenant-a")).replies.map(r => r.messageId)).toEqual(["kept"]);
  });
  it("uses a partial allowance and resumes the remaining message IDs without relisting", async () => {
    mocks.list.mockResolvedValue({ data: { messages: ["one","two","three","four"].map(id => ({ id })), nextPageToken: "older" } });
    vi.mocked(reserveGmailQuota).mockImplementation(async (_org, units) => Math.min(units, 40));
    const first = await gmail.fetchReplies(12345,"tenant-a");
    expect(first.replies.map(r=>r.messageId)).toEqual(["one","two"]);
    vi.mocked(reserveGmailQuota).mockImplementation(async (_org, units) => units);
    const last = await gmail.fetchReplies(12345,"tenant-a",{ pageToken:first.nextPageToken });
    expect(last.replies.map(r=>r.messageId)).toEqual(["three","four"]);
    expect(last.nextPageToken).toBe("older");
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });
  it("continues the same search range on the supplied page rather than skipping old replies", async () => {
    mocks.list.mockResolvedValue({ data: { messages: [{ id: "older-mail" }] } });
    const result = await gmail.fetchReplies(12345, "tenant-a", { pageToken: "older-page" });
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ pageToken: "older-page", q: expect.stringContaining("after:12345") }));
    expect(result.replies[0].messageId).toBe("older-mail");
    expect(result.truncated).toBeUndefined();
  });
});

describe("acknowledgment thread evidence",()=>{
 const expected={threadId:"thread",messageId:"decline",rfc822MessageId:"<decline@example.test>",sender:"supplier@example.test"};
 const target=()=>({id:"decline",internalDate:"1000",labelIds:["INBOX"],payload:{headers:[{name:"Message-ID",value:expected.rfc822MessageId},{name:"From",value:"Sam <supplier@example.test>"}]}});
 beforeEach(()=>{vi.clearAllMocks();mocks.thread.mockResolvedValue({data:{messages:[{id:"request",internalDate:"900",labelIds:["SENT"]},target()]}});});
 it("allows only the exact latest human decline",async()=>expect(await gmail.declineThreadUnchanged("tenant-a",expected)).toBe(true));
 it.each(["SENT","INBOX"])("stops when a later %s message exists",async(label)=>{
  mocks.thread.mockResolvedValue({data:{messages:[target(),{id:"later",internalDate:"1100",labelIds:[label]}]}});
  expect(await gmail.declineThreadUnchanged("tenant-a",expected)).toBe(false);
 });
 it("stops for an autoresponder or unreadable thread",async()=>{
  const auto=target();auto.payload.headers.push({name:"Auto-Submitted",value:"auto-generated"});
  mocks.thread.mockResolvedValue({data:{messages:[auto]}});expect(await gmail.declineThreadUnchanged("tenant-a",expected)).toBe(false);
  mocks.thread.mockRejectedValue(Error("read denied"));expect(await gmail.declineThreadUnchanged("tenant-a",expected)).toBe(false);
 });
 it("does not bind an uncertain attempt to a similar subject without the exact intent marker",async()=>{
  mocks.list.mockResolvedValue({data:{messages:[{id:"sent"}]}});
  const headers=[{name:"To",value:"supplier@example.test"},{name:"Subject",value:"Quote request"},{name:"Message-ID",value:"<sent@example.test>"}];
  mocks.get.mockResolvedValue({data:{payload:{headers}}});
  expect(await gmail.findSentMessage("tenant-a",{to:expected.sender,subject:"Quote request",afterEpochSec:1,intentId:"exact-intent"})).toEqual({status:"not_found"});
  headers.push({name:"X-Brostco-Intent-ID",value:"exact-intent"});
  expect(await gmail.findSentMessage("tenant-a",{to:expected.sender,subject:"Quote request",afterEpochSec:1,intentId:"exact-intent"})).toMatchObject({status:"found",messageId:"sent"});
 });
});
