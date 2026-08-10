/**
 * Document storage with a DURABLE default that needs no external service.
 *
 * Order of preference:
 *   1. Supabase Storage, only when SUPABASE_URL / SERVICE_ROLE_KEY are set
 *      (kept for existing setups / signed-URL delivery).
 *   2. Postgres (bytea in `file_blobs`), the default. The database is already
 *      the platform's durable store, so files survive redeploys (Replit's disk
 *      is ephemeral) with no separate account that can be paused/deactivated.
 *   3. Local disk, only as a last resort for reads of legacy files or when the
 *      DB write itself fails.
 */
import { config } from "../config";
import { query, queryOne } from "../db";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { promises as fs } from "fs";
import path from "path";
import { createHmac, timingSafeEqual } from "crypto";

/** HMAC token for time-limited public access to a stored file. */
export function fileToken(key: string, exp: number): string {
  return createHmac("sha256", config.auth.secret)
    .update(`file:${key}:${exp}`)
    .digest("hex");
}

/** Validate a file-access token produced by `fileToken`. */
export function verifyFileToken(key: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = fileToken(key, exp);
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

type Backend = "supabase" | "db" | "local";

const LOCAL_ROOT = path.join(process.cwd(), ".data", "storage");

let cachedClient: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (!cachedClient) {
    cachedClient = createClient(config.supabase.url, config.supabase.serviceKey);
  }
  return cachedClient;
}

function localPathFor(key: string): string {
  // Guard against path traversal / absolute escapes; keep files under LOCAL_ROOT.
  const normalized = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, "");
  return path.join(LOCAL_ROOT, normalized);
}

async function writeLocal(key: string, data: Buffer): Promise<void> {
  const full = localPathFor(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
}

async function readLocal(key: string): Promise<Buffer> {
  return fs.readFile(localPathFor(key));
}

async function writeDb(key: string, data: Buffer, mime: string): Promise<void> {
  await query(
    `insert into file_blobs (path, mime, bytes)
       values ($1, $2, $3)
     on conflict (path) do update set mime = excluded.mime, bytes = excluded.bytes, created_at = now()`,
    [key, mime, data]
  );
}

/** Read a blob from Postgres, or null when it isn't there. */
async function readDb(key: string): Promise<Buffer | null> {
  const row = await queryOne<{ bytes: Buffer }>(`select bytes from file_blobs where path = $1`, [
    key,
  ]);
  return row?.bytes ?? null;
}

export interface UploadResult {
  path: string;
  backend: Backend;
}

export const storage = {
  // Storage is always available now (Postgres is the durable default), so this
  // is true unless something is truly misconfigured.
  enabled: () => true,

  /** Store a document. Supabase when configured, otherwise durably in Postgres. */
  async upload(key: string, data: Buffer, mime: string): Promise<UploadResult> {
    if (config.supabase.enabled) {
      const { error } = await client()
        .storage.from(config.supabase.bucket)
        .upload(key, data, { upsert: true, contentType: mime });
      if (error) throw new Error(`[storage] Supabase upload failed: ${error.message}`);
      return { path: key, backend: "supabase" };
    }
    // Durable default: store the bytes in Postgres so they survive redeploys.
    try {
      await writeDb(key, data, mime);
      return { path: key, backend: "db" };
    } catch (err) {
      // Last resort so a document is never silently lost, though local disk is
      // ephemeral on Replit (this path should be rare).
      console.warn(
        `[storage] Postgres write failed, falling back to local disk: ${(err as Error).message}`
      );
      await writeLocal(key, data);
      return { path: key, backend: "local" };
    }
  },

  /**
   * Retrieve a document. With an explicit backend, read exactly that; otherwise
   * try Postgres first (the default store) and fall back to local disk so legacy
   * files still resolve.
   */
  async download(key: string, backend?: Backend): Promise<Buffer> {
    const target: Backend | undefined =
      backend ?? (config.supabase.enabled ? "supabase" : undefined);

    if (target === "supabase") {
      const { data, error } = await client()
        .storage.from(config.supabase.bucket)
        .download(key);
      if (error || !data) {
        throw new Error(`[storage] Supabase download failed: ${error?.message ?? "no data"}`);
      }
      const arrayBuffer = await data.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
    if (target === "local") return readLocal(key);

    // Default (target undefined) or explicit "db": Postgres first, then disk.
    const fromDb = await readDb(key);
    if (fromDb) return fromDb;
    return readLocal(key);
  },

  /**
   * Create a time-limited access URL. For Supabase this is a real signed URL;
   * for the local backend it points at the app's own file-serving route.
   */
  async signedUrl(key: string, expiresSeconds = 3600): Promise<string | null> {
    if (config.supabase.enabled) {
      const { data, error } = await client()
        .storage.from(config.supabase.bucket)
        .createSignedUrl(key, expiresSeconds);
      if (error || !data) return null;
      return data.signedUrl;
    }
    // Encode each path segment (not the whole key) so slashes stay real path
    // separators, encoding them to %2F produces URLs some proxies/CDNs 404 on.
    // Sign the URL with a time-limited HMAC token so external recipients
    // (e.g. subcontractors receiving document links) can access it without an
    // app login.
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    const exp = Math.floor(Date.now() / 1000) + expiresSeconds;
    const sig = fileToken(key, exp);
    return `${config.appUrl}/api/files/${encoded}?exp=${exp}&sig=${sig}`;
  },

  /** Best-effort private bucket creation. No-op when Supabase is unconfigured. */
  async ensureBucket(): Promise<void> {
    if (!config.supabase.enabled) {
      console.warn("[storage] Supabase not configured, skipping ensureBucket");
      return;
    }
    const { error } = await client().storage.createBucket(config.supabase.bucket, {
      public: false,
    });
    if (error && !/already exists/i.test(error.message)) {
      console.warn(`[storage] ensureBucket: ${error.message}`);
    }
  },
};
