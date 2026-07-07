/**
 * Document storage, Supabase Storage primary, local-disk fallback. When
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are unset, every operation degrades
 * to a `.data/storage` directory on the local filesystem so the platform keeps
 * working (dev, self-host, or an outage) without throwing.
 */
import { config } from "../config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { promises as fs } from "fs";
import path from "path";

type Backend = "supabase" | "local";

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

export interface UploadResult {
  path: string;
  backend: Backend;
}

export const storage = {
  enabled: () => config.supabase.enabled,

  /** Store a document. Uses Supabase when configured, otherwise local disk. */
  async upload(key: string, data: Buffer, mime: string): Promise<UploadResult> {
    if (config.supabase.enabled) {
      const { error } = await client()
        .storage.from(config.supabase.bucket)
        .upload(key, data, { upsert: true, contentType: mime });
      if (error) throw new Error(`[storage] Supabase upload failed: ${error.message}`);
      return { path: key, backend: "supabase" };
    }
    console.warn("[storage] Supabase not configured, writing to local disk");
    await writeLocal(key, data);
    return { path: key, backend: "local" };
  },

  /** Retrieve a document from the given backend (defaults to whichever is active). */
  async download(key: string, backend?: Backend): Promise<Buffer> {
    const target: Backend = backend ?? (config.supabase.enabled ? "supabase" : "local");
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
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    return `${config.appUrl}/api/files/${encoded}`;
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
