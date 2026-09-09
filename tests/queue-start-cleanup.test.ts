import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), create: vi.fn(), send: vi.fn(), options: vi.fn() }));
vi.mock("pg-boss", () => ({ default: class {
  constructor(options: unknown) { mocks.options(options); }
  on() {}
  start = mocks.start;
  stop = mocks.stop;
  createQueue = mocks.create;
  send = mocks.send;
} }));
vi.mock("@/lib/config", () => ({ config: { queue: { backend: "pgboss" }, database: { url: "postgresql://disposable.invalid/test" } }, pgSslFor: () => undefined }));
import { getQueue, resetQueue } from "@/lib/queue";

describe("queue initialization failures", () => {
  beforeEach(async () => {
    await resetQueue();
    vi.clearAllMocks();
    mocks.start.mockResolvedValue(undefined);
    mocks.stop.mockResolvedValue(undefined);
    mocks.create.mockResolvedValue(undefined);
    mocks.send.mockResolvedValue("job-a");
  });
  it("releases a partially opened backend and lets the next attempt recover", async () => {
    mocks.start.mockRejectedValueOnce(new Error("connection failed"));
    await expect(getQueue()).rejects.toThrow("connection failed");
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    await expect(getQueue()).resolves.toBeDefined();
    expect(mocks.options).toHaveBeenCalledTimes(2);
    expect(mocks.options).toHaveBeenLastCalledWith(expect.objectContaining({ connectionTimeoutMillis: 10000, query_timeout: 30000, statement_timeout: 30000 }));
  });
  it("does not publish a queue as ready when queue creation was refused", async () => {
    mocks.create.mockRejectedValueOnce(new Error("permission denied for schema"));
    await expect(getQueue()).rejects.toThrow("permission denied for schema");
    expect(mocks.stop).toHaveBeenCalled();
    await expect(getQueue()).resolves.toBeDefined();
  });
  it("propagates enqueue setup errors instead of claiming a dropped job was accepted", async () => {
    const queue = await getQueue();
    mocks.create.mockRejectedValueOnce(new Error("queue creation failed"));
    await expect(queue.enqueue("new-queue", {})).rejects.toThrow("queue creation failed");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not rewrite queue metadata for every job after startup", async () => {
    const queue = await getQueue();
    mocks.create.mockClear();
    await queue.enqueue("scoring-engine", {});
    await queue.enqueue("scoring-engine", {});
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
});
