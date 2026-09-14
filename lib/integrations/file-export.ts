/**
 * File storage providers: a Brost Co folder, a subfolder per opportunity,
 * and uploads into it. Nothing is read back except what was created here.
 */
import { Readable } from "node:stream";
import { google } from "googleapis";
import { accessToken, googleAuthFor, updateSettings, type ServiceRow } from "../connected-services";
import { fetchJson } from "./http";

const ROOT = "Brost Co";

export interface UploadedFile {
  remoteId: string;
  url: string | null;
}

/** The id of the provider folder for this opportunity, created on first use. */
export async function ensureOpportunityFolder(row: ServiceRow, opportunityId: string, name: string): Promise<string> {
  const known = (row.settings?.folders as Record<string, string> | undefined) ?? {};
  if (known[opportunityId]) return known[opportunityId];
  const rootId = await ensureRoot(row);
  const id = await createFolder(row, name, rootId);
  await updateSettings(row.id, row.org_id, { folders: { ...known, [opportunityId]: id } });
  return id;
}

async function ensureRoot(row: ServiceRow): Promise<string> {
  const rootId = row.settings?.root_folder_id;
  if (typeof rootId === "string" && rootId) return rootId;
  const id = await createFolder(row, ROOT, null);
  await updateSettings(row.id, row.org_id, { root_folder_id: id });
  return id;
}

async function createFolder(row: ServiceRow, name: string, parentId: string | null): Promise<string> {
  switch (row.provider) {
    case "google_drive": {
      const auth = await googleAuthFor(row);
      const res = await google.drive({ version: "v3", auth }).files.create({
        requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: parentId ? [parentId] : undefined },
        fields: "id",
      });
      if (!res.data.id) throw new Error("Google Drive did not return a folder id.");
      return res.data.id;
    }
    case "microsoft_onedrive": {
      const token = await accessToken(row);
      const url = parentId
        ? `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(parentId)}/children`
        : "https://graph.microsoft.com/v1.0/me/drive/root/children";
      const res = await fetchJson<{ id: string }>(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "rename" }),
      });
      return res.id;
    }
    case "dropbox": {
      const token = await accessToken(row);
      const path = parentId ? `${parentId}/${name}` : `/${ROOT}`;
      try {
        const res = await fetchJson<{ metadata: { path_lower: string } }>("https://api.dropboxapi.com/2/files/create_folder_v2", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ path, autorename: false }),
        });
        return res.metadata.path_lower;
      } catch (err) {
        // Already there is fine: the path is the id.
        if (/conflict/i.test(String((err as Error).message)) || /path\/conflict/.test(JSON.stringify((err as { body?: unknown }).body ?? ""))) return path.toLowerCase();
        throw err;
      }
    }
    case "box": {
      const token = await accessToken(row);
      try {
        const res = await fetchJson<{ id: string }>("https://api.box.com/2.0/folders", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ name, parent: { id: parentId ?? "0" } }),
        });
        return res.id;
      } catch (err) {
        const body = (err as { body?: { context_info?: { conflicts?: { id?: string }[] } } }).body;
        const existing = body?.context_info?.conflicts?.[0]?.id;
        if (existing) return existing;
        throw err;
      }
    }
    default:
      throw new Error("Not a file storage connection.");
  }
}

export async function uploadFile(row: ServiceRow, folderId: string, name: string, mime: string, bytes: Buffer): Promise<UploadedFile> {
  switch (row.provider) {
    case "google_drive": {
      const auth = await googleAuthFor(row);
      const res = await google.drive({ version: "v3", auth }).files.create({
        requestBody: { name, parents: [folderId] },
        media: { mimeType: mime, body: Readable.from(bytes) },
        fields: "id, webViewLink",
      });
      if (!res.data.id) throw new Error("Google Drive did not return a file id.");
      return { remoteId: res.data.id, url: res.data.webViewLink ?? null };
    }
    case "microsoft_onedrive": {
      const token = await accessToken(row);
      const res = await fetchJson<{ id: string; webUrl?: string }>(
        `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(name)}:/content`,
        { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": mime }, body: new Uint8Array(bytes), timeoutMs: 120_000 }
      );
      return { remoteId: res.id, url: res.webUrl ?? null };
    }
    case "dropbox": {
      const token = await accessToken(row);
      const res = await fetchJson<{ id: string; path_lower: string }>("https://content.dropboxapi.com/2/files/upload", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/octet-stream",
          "Dropbox-API-Arg": JSON.stringify({ path: `${folderId}/${name}`, mode: "overwrite", mute: true }),
        },
        body: new Uint8Array(bytes),
        timeoutMs: 120_000,
      });
      return { remoteId: res.id, url: null };
    }
    case "box": {
      const token = await accessToken(row);
      const fd = new FormData();
      fd.append("attributes", JSON.stringify({ name, parent: { id: folderId } }));
      fd.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), name);
      const res = await fetchJson<{ entries: { id: string }[] }>("https://upload.box.com/api/2.0/files/content", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: fd,
        timeoutMs: 120_000,
      });
      const id = res.entries?.[0]?.id;
      if (!id) throw new Error("Box did not return a file id.");
      return { remoteId: id, url: `https://app.box.com/file/${id}` };
    }
    default:
      throw new Error("Not a file storage connection.");
  }
}
