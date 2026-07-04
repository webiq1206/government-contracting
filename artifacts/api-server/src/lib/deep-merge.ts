/**
 * Recursively merges `patch` into `base` with the following rules:
 *
 *  - A key present in `patch` with an **undefined** value is **skipped** — the
 *    base value is preserved unchanged. (Note: Object.entries *does* yield keys
 *    whose value is undefined, so this guard is explicit and intentional.)
 *  - A key present in `patch` with a **null** value is **deleted** from the result.
 *  - A key present in `patch` with an object value is merged recursively when the
 *    corresponding `base` value is also a plain object (not an array, not null).
 *  - All other values overwrite the base value.
 *  - Keys absent from `patch` are left untouched in the result.
 */
export function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) {
      // Explicitly skip — do not touch the existing value.
      continue;
    } else if (v === null) {
      delete result[k];
    } else if (
      typeof v === "object" &&
      !Array.isArray(v) &&
      typeof result[k] === "object" &&
      result[k] !== null &&
      !Array.isArray(result[k])
    ) {
      result[k] = deepMerge(
        result[k] as Record<string, unknown>,
        v as Record<string, unknown>
      );
    } else {
      result[k] = v;
    }
  }
  return result;
}
