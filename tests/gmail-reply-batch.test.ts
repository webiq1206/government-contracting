import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn() }));
vi.mock("../lib/config", () => ({ config: { gmail: { configured: true } } }));
vi.mock("../lib/db", () => ({ query: async () => [], queryOne: async () => ({ data: { refresh_token: "test-refresh" } }) }));
vi.mock("googleapis", () => ({ google: {
  auth: { OAuth2: class { setCredentials() {} } },
  gmail: () => ({ users: { messages: { list: mocks.list, get: mocks.get } } }),
} }));
vi.mock("../lib/integrations/gmail-quota", () => ({ reserveGmailQuota: vi.fn(async () => undefined) }));
import { gmail } from "../lib/integrations/gmail";
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
  it("continues the same search range on the supplied page rather than skipping old replies", async () => {
    mocks.list.mockResolvedValue({ data: { messages: [{ id: "older-mail" }] } });
    const result = await gmail.fetchReplies(12345, "tenant-a", { pageToken: "older-page" });
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ pageToken: "older-page", q: expect.stringContaining("after:12345") }));
    expect(result.replies[0].messageId).toBe("older-mail");
    expect(result.truncated).toBeUndefined();
  });
});
