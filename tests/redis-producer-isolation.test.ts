import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  consumers: vi.fn(), processor: null as null | ((job: { name: string; data: unknown }) => Promise<void>),
  ready: vi.fn(), add: vi.fn(), ping: vi.fn(), close: vi.fn(), disconnect: vi.fn(), duplicate: vi.fn(),
}));
vi.mock("bullmq", () => ({
  Queue: class {
    on() {}
    waitUntilReady = mocks.ready;
    add = mocks.add;
    close = mocks.close;
  },
  Worker: class {
    constructor(name: string, processor: typeof mocks.processor, options: unknown) {
      mocks.consumers(name, options);
      mocks.processor = processor;
    }
    on() {}
    waitUntilReady = mocks.ready;
    isRunning() { return true; }
    close = mocks.close;
  },
}));
vi.mock("ioredis", () => ({ default: class {
  ping = mocks.ping;
  disconnect = mocks.disconnect;
  duplicate(options: unknown) { mocks.duplicate(options); return { disconnect: mocks.disconnect }; }
} }));
vi.mock("@/lib/config", () => ({ config: { queue: { redisUrl: "redis://disposable.invalid" } } }));
import { createBullQueue } from "@/lib/queue/bullmq";

describe("Redis producer and consumer ownership", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ready.mockResolvedValue(undefined);
    mocks.add.mockResolvedValue({ id: "job-a" });
    mocks.ping.mockResolvedValue("PONG");
    mocks.close.mockResolvedValue(undefined);
  });
  it("allows a web producer to enqueue without taking jobs from the worker", async () => {
    const queue = await createBullQueue();
    await queue.start();
    await queue.enqueue("scoring-engine", {});
    expect(mocks.consumers).not.toHaveBeenCalled();
    expect(await queue.healthy?.()).toBe(true);
    await queue.stop();
    expect(mocks.disconnect).toHaveBeenCalled();
  });
  it("ends stalled startup and disconnects instead of waiting forever", async () => {
    vi.useFakeTimers();
    mocks.ready.mockImplementationOnce(() => new Promise(() => {}));
    const queue = await createBullQueue();
    const failure = expect(queue.start()).rejects.toThrow("Redis queue startup");
    await vi.advanceTimersByTimeAsync(20_000);
    await failure;
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(await queue.healthy?.()).toBe(false);
  });
  it("does not consume until every handler has been registered and activation is explicit", async () => {
    const queue = await createBullQueue();
    await queue.start();
    const a = vi.fn(); const b = vi.fn();
    await queue.work("agent-a", a);
    await queue.work("agent-b", b);
    expect(mocks.consumers).not.toHaveBeenCalled();
    await queue.activate?.();
    await mocks.processor!({ name: "agent-b", data: { id: "record" } });
    expect(b).toHaveBeenCalledWith({ id: "record" });
    expect(a).not.toHaveBeenCalled();
    expect(mocks.duplicate).toHaveBeenCalledWith({ maxRetriesPerRequest: null, enableOfflineQueue: true });
    await queue.stop();
  });
  it("refuses consumer activation when no handlers exist", async () => {
    const queue = await createBullQueue();
    await queue.start();
    await expect(queue.activate?.()).rejects.toThrow("Register queue handlers");
    expect(mocks.consumers).not.toHaveBeenCalled();
    await queue.stop();
  });
  it("makes colon-containing keys valid and keeps tenant/agent deduplication separate", async () => {
    const queue = await createBullQueue();
    await queue.start();
    await queue.enqueue("agent-a", { enqueuedByOrgId: "org-a" }, { singletonKey: "score:record" });
    await queue.enqueue("agent-a", { enqueuedByOrgId: "org-b" }, { singletonKey: "score:record" });
    await queue.enqueue("agent-b", { enqueuedByOrgId: "org-a" }, { singletonKey: "score:record" });
    const keys = mocks.add.mock.calls.map(call => call[2].jobId);
    expect(new Set(keys).size).toBe(3);
    expect(keys.every(key => /^[a-f0-9]{64}$/.test(key))).toBe(true);
    await queue.stop();
  });
});
