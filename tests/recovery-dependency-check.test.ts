import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ complete: vi.fn(), gmail: vi.fn(), heartbeat: vi.fn(), healthy: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/ai/claude", () => ({ complete: mocks.complete, describeClaudeFailure: () => null }));
vi.mock("@/lib/integrations/gmail", () => ({ gmail: { canAuthenticate: mocks.gmail } }));
vi.mock("@/lib/worker-heartbeat", () => ({ readWorkerHeartbeat: mocks.heartbeat }));
vi.mock("@/lib/queue", () => ({ enqueue: vi.fn(), getQueue: async () => ({ healthy: mocks.healthy }) }));
vi.mock("@/lib/db", () => ({ query: mocks.query, queryOne: vi.fn(), transaction: vi.fn() }));
import { testIncidentDependency } from "@/lib/recovery";

describe("recovery checks the failed dependency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.complete.mockResolvedValue({ text: "ready" });
    mocks.gmail.mockResolvedValue(true);
    mocks.healthy.mockResolvedValue(true);
    mocks.heartbeat.mockResolvedValue({ phase: "ready", updatedAt: new Date() });
    mocks.query.mockResolvedValue([]);
  });
  it("does not spend AI credit to test a mailbox, and bypasses a stale auth probe", async () => {
    expect((await testIncidentDependency("integration_auth", "org-a")).passed).toBe(true);
    expect(mocks.gmail).toHaveBeenCalledWith("org-a", { fresh: true });
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("keeps a rejected mailbox blocked even when AI would answer", async () => {
    mocks.gmail.mockResolvedValue(false);
    expect((await testIncidentDependency("integration_auth", "org-a")).passed).toBe(false);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("checks Gmail for Gmail throttling without spending AI credit", async () => {
    expect((await testIncidentDependency("mailbox_rate_limit", "org-a")).model).toBe("gmail");
    expect(mocks.gmail).toHaveBeenCalledWith("org-a", { fresh: true });
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("does not declare corrupt mail repaired just because authentication works", async () => {
    expect((await testIncidentDependency("mailbox_content", "org-a")).passed).toBe(false);
    expect(mocks.gmail).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("requires a ready worker and working queue, not only a live database", async () => {
    expect((await testIncidentDependency("queue_unreachable", "org-a")).passed).toBe(true);
    mocks.heartbeat.mockResolvedValue({ phase: "ready", updatedAt: new Date(0) });
    expect((await testIncidentDependency("queue_unreachable", "org-a")).passed).toBe(false);
    mocks.heartbeat.mockResolvedValue({ phase: "ready", updatedAt: new Date() });
    mocks.healthy.mockResolvedValue(false);
    expect((await testIncidentDependency("queue_unreachable", "org-a")).passed).toBe(false);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("uses a small, bounded AI test without including the company profile", async () => {
    expect((await testIncidentDependency("provider_credit", "org-a")).passed).toBe(true);
    expect(mocks.complete).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ injectProfile: false, maxTokens: 16, timeoutMs: 15000, maxRetries: 0 }));
  });
  it("does not claim an unknown or missing-setup issue was repaired by an AI response", async () => {
    expect((await testIncidentDependency("unknown", "org-a")).passed).toBe(false);
    expect((await testIncidentDependency("not_configured", "org-a")).passed).toBe(false);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
