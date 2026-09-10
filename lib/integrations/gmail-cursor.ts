/** A partial page keeps message IDs, never message bodies or credentials. */
export interface GmailPageRemainder { ids: string[]; next?: string }
const PREFIX = "brostco-gmail-v1:";
export function encodeGmailRemainder(value: GmailPageRemainder): string {
  return PREFIX + Buffer.from(JSON.stringify(value)).toString("base64url");
}
export function decodeGmailRemainder(token?: string): GmailPageRemainder | null {
  if (!token?.startsWith(PREFIX)) return null;
  try {
    const value = JSON.parse(Buffer.from(token.slice(PREFIX.length), "base64url").toString());
    if (!Array.isArray(value.ids) || value.ids.length > 100 || !value.ids.length ||
        !value.ids.every((id: unknown) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(id)) ||
        (value.next != null && (typeof value.next !== "string" || value.next.length > 10000))) throw new Error();
    return value;
  } catch { throw new Error("Invalid Gmail page token. The same scan range will be read again safely."); }
}
