import { expect, it } from "vitest";
import { manualSendStorageKey, preserveSendRequest } from "../lib/client/manual-send-request";
it("keeps the same key across retries and remounts, and shares profile/inbox thread identity", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
  const key = manualSendStorageKey("sub", null, "project");
  expect(key).toBe("manual-email:pair:project:sub:sub");
  expect(preserveSendRequest(storage, key, () => "first")).toBe("first");
  expect(preserveSendRequest(storage, key, () => "second")).toBe("first");
  expect(preserveSendRequest(storage, manualSendStorageKey("sub", "thread2", "project"), () => "second")).toBe("second");
});
it("fails closed before sending when the browser cannot preserve a key", () => {
  expect(() => preserveSendRequest({ getItem: () => null, setItem: () => { throw new Error("storage disabled"); } }, "key", () => "id")).toThrow("storage disabled");
});
