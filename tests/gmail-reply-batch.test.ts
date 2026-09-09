import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn() }));
vi.mock("../lib/config", () => ({ config: { gmail: { configured: true } } }));
vi.mock("../lib/db", () => ({ query: vi.fn(), queryOne: async () => ({ data: { refresh_token: "test-refresh" } }) }));
vi.mock("googleapis", () => ({ google: {
  auth: { OAuth2: class { setCredentials() {} } },
  gmail: () => ({ users: { messages: { list: mocks.list, get: mocks.get } } }),
} }));
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
  it("continues the same search range on the supplied page rather than skipping old replies", async () => {
    mocks.list.mockResolvedValue({ data: { messages: [{ id: "older-mail" }] } });
    const result = await gmail.fetchReplies(12345, "tenant-a", { pageToken: "older-page" });
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ pageToken: "older-page", q: expect.stringContaining("after:12345") }));
    expect(result.replies[0].messageId).toBe("older-mail");
    expect(result.truncated).toBeUndefined();
  });
});
