/**
 * Stable identity for an attachment reference from an external notice.
 *
 * SAM can reorder resource links and can rotate the API key in their query
 * strings. Neither changes which source document the URL identifies. Keeping
 * those details out of the identity prevents a reordered amendment from
 * overwriting a different file's inventory row.
 */
import { createHash } from "node:crypto";

export interface AttachmentReference {
  name: string;
  url?: string;
  storage_path?: string;
  mime?: string;
}

const VOLATILE_QUERY_KEYS = new Set([
  "api_key",
  "apikey",
  "access_token",
  "token",
  "signature",
  "expires",
  "x-amz-algorithm",
  "x-amz-credential",
  "x-amz-date",
  "x-amz-expires",
  "x-amz-security-token",
  "x-amz-signature",
  "x-amz-signedheaders",
]);

export function canonicalAttachmentUrl(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (VOLATILE_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.searchParams.sort();
    return url.toString();
  } catch {
    return raw;
  }
}

export function attachmentIdentity(
  ref: Pick<AttachmentReference, "name" | "url" | "storage_path">
): string {
  const source =
    canonicalAttachmentUrl(ref.url) ||
    (ref.storage_path?.trim() ? `storage:${ref.storage_path.trim()}` : "") ||
    `name:${ref.name.trim().toLowerCase()}`;
  return createHash("sha256").update(source).digest("hex");
}

export function attachmentReferences(value: unknown): AttachmentReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const url = typeof row.url === "string" ? row.url.trim() : "";
    const storagePath = typeof row.storage_path === "string" ? row.storage_path.trim() : "";
    const mime = typeof row.mime === "string" ? row.mime.trim() : "";
    if (!name && !url && !storagePath) return [];
    return [{
      name: name || "attachment",
      ...(url ? { url } : {}),
      ...(storagePath ? { storage_path: storagePath } : {}),
      ...(mime ? { mime } : {}),
    }];
  });
}

/**
 * Preserve the first-seen order and append genuinely new references. A fresh
 * URL replaces an older URL with the same stable identity so rotated access
 * credentials are used on the next fetch.
 */
export function mergeAttachmentReferences(
  existing: unknown,
  incoming: unknown
): AttachmentReference[] {
  const merged: AttachmentReference[] = [];
  const position = new Map<string, number>();
  for (const ref of [
    ...attachmentReferences(existing),
    ...attachmentReferences(incoming),
  ]) {
    const key = attachmentIdentity(ref);
    const at = position.get(key);
    if (at == null) {
      position.set(key, merged.length);
      merged.push(ref);
    } else {
      merged[at] = { ...merged[at], ...ref };
    }
  }
  return merged;
}
