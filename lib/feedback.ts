import { query, queryOne } from "@/lib/db";
import { storage } from "@/lib/integrations/storage";
import { ALLOWED_UPLOAD_MIME, MAX_UPLOAD_BYTES } from "@/lib/sub-compliance-store";
import {
  isFeedbackCategory,
  messageProblem,
  safeBrowser,
  safePage,
  sanitizeDiagnostics,
  type Diagnostics,
} from "@/lib/domain/feedback";

/**
 * Filing a report about the product.
 *
 * Every field is normalised here rather than at the edge, because the route
 * is one caller and the next one will not remember the rules. The screenshot
 * is stored under the same tenant-scoped key shape as every other file, so
 * the ownership resolver governs who can read it back.
 */

export interface FeedbackRecord {
  id: string;
  category: string;
  message: string;
  page: string | null;
  browser: string | null;
  diagnostics: Diagnostics | null;
  diagnostics_consented: boolean;
  storage_path: string | null;
  screenshot_name: string | null;
  status: string;
  created_at: string;
  user_email: string | null;
}

export type FeedbackOutcome =
  | { ok: true; id: string; screenshotStored: boolean; screenshotProblem?: string }
  | { ok: false; error: string };

export interface FeedbackInput {
  orgId: string;
  userId: string | null;
  userEmail: string | null;
  category: string;
  message: string;
  page?: string | null;
  userAgent?: string | null;
  /** Only kept when consent is true. Enforced again by a check constraint. */
  diagnostics?: unknown;
  diagnosticsConsented?: boolean;
  screenshot?: File | null;
}

export async function submitFeedback(input: FeedbackInput): Promise<FeedbackOutcome> {
  if (!isFeedbackCategory(input.category)) {
    return { ok: false, error: "Pick what kind of problem this is." };
  }
  const bad = messageProblem(input.message);
  if (bad) return { ok: false, error: bad };

  const consented = input.diagnosticsConsented === true;
  // Unticked means nothing extra is kept, which has to be true here and not
  // only in the sentence next to the checkbox.
  const diagnostics = consented ? sanitizeDiagnostics(input.diagnostics) : null;

  /*
   * The screenshot is filed first, and a failure to store it does not fail
   * the report.
   *
   * Somebody who has just written out what went wrong should not lose it
   * because an image was too large. The report is saved either way and says
   * what happened to the picture.
   */
  let storagePath: string | null = null;
  let screenshotName: string | null = null;
  let screenshotProblem: string | undefined;
  if (input.screenshot && input.screenshot.size > 0) {
    const file = input.screenshot;
    const mime = file.type || "application/octet-stream";
    if (file.size > MAX_UPLOAD_BYTES) {
      screenshotProblem = "The screenshot was over 12 MB, so it was not attached. The report was sent without it.";
    } else if (!ALLOWED_UPLOAD_MIME.has(mime) && !/\.(png|jpe?g|gif|webp)$/i.test(file.name)) {
      screenshotProblem = "That file is not an image, so it was not attached. The report was sent without it.";
    } else {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "screenshot.png";
      const key = `feedback/${input.orgId}/${Date.now()}-${safeName}`;
      const bytes = Buffer.from(await file.arrayBuffer());
      const up = await storage.upload(key, bytes, mime).catch((e: unknown) => {
        console.warn("[feedback] screenshot upload failed:", e);
        return null;
      });
      if (up) {
        storagePath = up.path;
        screenshotName = file.name.slice(0, 200);
      } else {
        screenshotProblem = "The screenshot could not be stored. The report was sent without it.";
      }
    }
  }

  const rows = await query<{ id: string }>(
    `insert into feedback_reports
       (org_id, user_id, user_email, category, message, page, browser,
        diagnostics, diagnostics_consented, storage_path, screenshot_name)
     values ($1,$2::uuid,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
     returning id`,
    [
      input.orgId,
      input.userId,
      input.userEmail,
      input.category,
      input.message.trim(),
      safePage(input.page),
      safeBrowser(input.userAgent),
      diagnostics ? JSON.stringify(diagnostics) : null,
      consented,
      storagePath,
      screenshotName,
    ]
  );

  const id = rows[0]?.id;
  if (!id) return { ok: false, error: "The report could not be saved. Nothing was sent." };
  return { ok: true, id, screenshotStored: storagePath != null, screenshotProblem };
}

/** This organization's own reports, newest first. Scoped, always. */
export async function feedbackFor(orgId: string, limit = 20): Promise<FeedbackRecord[]> {
  return query<FeedbackRecord>(
    `select id, category, message, page, browser, diagnostics,
            diagnostics_consented, storage_path, screenshot_name, status,
            created_at::text as created_at, user_email
       from feedback_reports
      where org_id = $1
      order by created_at desc
      limit $2`,
    [orgId, limit]
  ).catch(() => []);
}

/** One report, scoped to the org that owns it. */
export async function feedbackReport(
  orgId: string,
  id: string
): Promise<FeedbackRecord | null> {
  return queryOne<FeedbackRecord>(
    `select id, category, message, page, browser, diagnostics,
            diagnostics_consented, storage_path, screenshot_name, status,
            created_at::text as created_at, user_email
       from feedback_reports
      where org_id = $1 and id = $2`,
    [orgId, id]
  ).catch(() => null);
}
