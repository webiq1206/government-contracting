import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../lib/db", () => ({ query: m.query }));
vi.mock("../lib/tenant-context", () => ({ actingOrgId: async () => "tenant-a" }));
import { logAgent } from "../lib/logger";
beforeEach(() => { vi.clearAllMocks(); });

it("requires a successful database write before a delivery notice counts as recorded", async () => {
  m.query.mockRejectedValue(new Error("database unavailable"));
  const entry = { agent: "reply-poll", action: "bounce-unmatched", input: { messageId: "mail-1" } };
  await expect(logAgent(entry, { requirePersistence: true })).rejects.toThrow("database unavailable");
  // Existing callers retain best-effort telemetry behavior.
  await expect(logAgent(entry)).resolves.toBeUndefined();
});

it("records the mailbox reference under the acting tenant", async () => {
  m.query.mockResolvedValue([]);
  await logAgent({ agent: "reply-poll", action: "bounce-unmatched", input: { messageId: "mail-1" } }, { requirePersistence: true });
  const params = m.query.mock.calls[0][1];
  expect(params[9]).toBe(JSON.stringify({ messageId: "mail-1" }));
  expect(params[13]).toBe("tenant-a");
});
