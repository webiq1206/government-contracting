import { describe, it, expect, afterEach } from "vitest";
import { ensurePromiseWithResolvers } from "@/lib/integrations/pdf";

type P = typeof Promise & { withResolvers?: unknown };

const native = (Promise as P).withResolvers;

afterEach(() => {
  if (native === undefined) delete (Promise as P).withResolvers;
  else (Promise as P).withResolvers = native;
});

describe("Promise.withResolvers shim for pdf.js on Node 20", () => {
  it("installs a working implementation when the runtime lacks one", async () => {
    delete (Promise as P).withResolvers;
    ensurePromiseWithResolvers();
    expect(typeof (Promise as P).withResolvers).toBe("function");

    const { promise, resolve } = (
      Promise as unknown as {
        withResolvers: <T>() => {
          promise: Promise<T>;
          resolve: (v: T) => void;
          reject: (r?: unknown) => void;
        };
      }
    ).withResolvers<string>();
    resolve("ok");
    await expect(promise).resolves.toBe("ok");
  });

  it("rejects through the shim too", async () => {
    delete (Promise as P).withResolvers;
    ensurePromiseWithResolvers();
    const { promise, reject } = (
      Promise as unknown as {
        withResolvers: <T>() => {
          promise: Promise<T>;
          resolve: (v: T) => void;
          reject: (r?: unknown) => void;
        };
      }
    ).withResolvers<string>();
    reject(new Error("nope"));
    await expect(promise).rejects.toThrow("nope");
  });

  it("never replaces a native implementation", () => {
    const sentinel = () => ({ promise: Promise.resolve(), resolve() {}, reject() {} });
    (Promise as P).withResolvers = sentinel;
    ensurePromiseWithResolvers();
    expect((Promise as P).withResolvers).toBe(sentinel);
  });
});
