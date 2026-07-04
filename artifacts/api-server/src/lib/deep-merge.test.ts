import { describe, it, expect } from "vitest";
import { deepMerge } from "./deep-merge";

describe("deepMerge", () => {
  it("adds new keys from patch", () => {
    const result = deepMerge({ a: 1 }, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("overwrites existing keys with patch values", () => {
    const result = deepMerge({ a: 1, b: "old" }, { b: "new" });
    expect(result).toEqual({ a: 1, b: "new" });
  });

  it("removes a key when patch value is null", () => {
    const result = deepMerge({ a: 1, b: "remove-me" }, { b: null });
    expect(result).toEqual({ a: 1 });
    expect(Object.prototype.hasOwnProperty.call(result, "b")).toBe(false);
  });

  it("removes multiple keys when patch sends null for each", () => {
    const result = deepMerge(
      { a: 1, b: 2, c: 3 },
      { b: null, c: null }
    );
    expect(result).toEqual({ a: 1 });
  });

  it("preserves an existing key when patch sends undefined for it", () => {
    // Object.entries yields undefined values — the guard must skip them
    // so that a partially-constructed patch object cannot silently erase data.
    const patch: Record<string, unknown> = { b: undefined };
    const result = deepMerge({ a: 1, b: "keep-me" }, patch);
    expect(result.b).toBe("keep-me");
    expect(result).toEqual({ a: 1, b: "keep-me" });
  });

  it("does not introduce a new key when patch value is undefined", () => {
    const patch: Record<string, unknown> = { newKey: undefined };
    const result = deepMerge({ a: 1 }, patch);
    expect(Object.prototype.hasOwnProperty.call(result, "newKey")).toBe(false);
  });

  it("round-trips safely: JSON.stringify of result preserves null-removed keys", () => {
    // Simulates the full store path: deepMerge → JSON.stringify → parse
    const merged = deepMerge({ a: 1, b: "bye" }, { b: null });
    const stored = JSON.parse(JSON.stringify(merged)) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(stored, "b")).toBe(false);
    expect(stored.a).toBe(1);
  });

  it("round-trips safely: undefined patch key does not vanish in JSON.stringify", () => {
    // Simulates the full store path: deepMerge → JSON.stringify → parse
    const patch: Record<string, unknown> = { b: undefined };
    const merged = deepMerge({ a: 1, b: "survive" }, patch);
    const stored = JSON.parse(JSON.stringify(merged)) as Record<string, unknown>;
    expect(stored.b).toBe("survive");
  });

  it("leaves untouched keys absent from patch intact", () => {
    const result = deepMerge({ a: 1, b: 2, c: 3 }, { b: 99 });
    expect(result.a).toBe(1);
    expect(result.c).toBe(3);
  });

  it("an empty patch leaves the base object unchanged", () => {
    const base = { a: 1, b: "hello" };
    const result = deepMerge(base, {});
    expect(result).toEqual(base);
  });

  it("does not mutate the original base object", () => {
    const base = { a: 1, b: "keep" };
    deepMerge(base, { b: null });
    expect(base).toEqual({ a: 1, b: "keep" });
  });

  it("recursively merges nested objects", () => {
    const base = { meta: { x: 1, y: 2 }, top: "a" };
    const result = deepMerge(base, { meta: { y: 99 } });
    expect(result).toEqual({ meta: { x: 1, y: 99 }, top: "a" });
  });

  it("removes nested keys when inner patch sends null", () => {
    const base = { meta: { x: 1, y: 2 } };
    const result = deepMerge(base, { meta: { y: null } });
    expect(result).toEqual({ meta: { x: 1 } });
    expect(Object.prototype.hasOwnProperty.call(result.meta, "y")).toBe(false);
  });

  it("preserves nested key when inner patch sends undefined", () => {
    const patch: Record<string, unknown> = { meta: { y: undefined } };
    const result = deepMerge({ meta: { x: 1, y: 42 } }, patch);
    expect((result.meta as Record<string, unknown>).y).toBe(42);
  });

  it("overwrites a nested object with a scalar when types differ", () => {
    const base = { meta: { x: 1 } };
    const result = deepMerge(base, { meta: "scalar" });
    expect(result).toEqual({ meta: "scalar" });
  });

  it("overwrites a nested object with an array (not deep-merged)", () => {
    const base = { tags: { a: 1 } };
    const result = deepMerge(base, { tags: [1, 2, 3] });
    expect(result).toEqual({ tags: [1, 2, 3] });
  });

  it("treats a patch on a base that is an array as overwrite, not merge", () => {
    const base = { items: [1, 2] };
    const result = deepMerge(base, { items: [3, 4, 5] });
    expect(result).toEqual({ items: [3, 4, 5] });
  });
});
