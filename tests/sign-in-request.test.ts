import { afterEach, describe, expect, it, vi } from "vitest";
import { requestSignIn } from "@/lib/client/sign-in";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("sign-in recovery", () => {
  it("accepts only an explicit successful authentication response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
    expect(await requestSignIn("test@example.invalid", "synthetic-test-password")).toEqual({ ok: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream error", { status: 200 })));
    expect(await requestSignIn("test@example.invalid", "synthetic-test-password")).toMatchObject({ ok: false });
  });

  it("preserves an actionable server refusal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Too many failed attempts. Try again in a few minutes." }, { status: 429 })));
    expect(await requestSignIn("test@example.invalid", "synthetic-test-password")).toMatchObject({ ok: false, error: expect.stringContaining("Too many") });
  });

  it("explains network failure and permits a subsequent successful retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("network failed")).mockResolvedValueOnce(Response.json({ ok: true })));
    expect(await requestSignIn("test@example.invalid", "synthetic-test-password")).toMatchObject({ ok: false, error: expect.stringContaining("Check your connection") });
    expect(await requestSignIn("test@example.invalid", "synthetic-test-password")).toEqual({ ok: true });
  });

  it("ends a stalled request instead of leaving Sign in disabled indefinitely", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")));
    })));
    const pending = requestSignIn("test@example.invalid", "synthetic-test-password");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toMatchObject({ ok: false, error: expect.stringContaining("took too long") });
    expect(vi.getTimerCount()).toBe(0);
  });
});
