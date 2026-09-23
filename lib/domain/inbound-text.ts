/** PostgreSQL text and jsonb cannot contain NUL. Keep a visible replacement
 * instead of joining characters across corrupt bytes (which can change prices).
 * Original message and attachment bytes remain in the connected mailbox. */
export function inboundText(value: string): string {
  return value.replace(/\u0000/g, "\uFFFD");
}

/** Normalize structured imported text before jsonb and text-array writes. */
export function deepInboundText<T>(value: T): T {
  if (typeof value === "string") return inboundText(value) as T;
  if (Array.isArray(value)) return value.map(deepInboundText) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) =>
      [inboundText(key), deepInboundText(child)])) as T;
  }
  return value;
}

/** Decode declared mail charsets and BOM-marked text attachments before saving.
 * In particular, treating UTF-16 as UTF-8 inserts NULs between every letter. */
export function decodeInboundText(bytes: Uint8Array, charset?: string): string {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be"
      : charset || "utf-8";
  let text: string;
  try {
    text = new TextDecoder(encoding).decode(bytes);
  } catch {
    text = new TextDecoder("utf-8").decode(bytes);
  }
  return inboundText(text);
}
