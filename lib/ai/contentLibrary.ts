/**
 * Content-library retrieval for the AI agents. Sits alongside companyProfile as
 * an assembler of prompt context: given the categories and tags that describe an
 * opportunity, it returns the best few pre-approved snippets to fold into a
 * draft. Every failure degrades to an empty array, so a not-yet-migrated
 * database or an empty library simply means the agents draft as they did before
 * this feature existed, exactly matching the platform's graceful-degradation
 * philosophy (a missing capability disables a feature, it never crashes a run).
 */
import { query } from "../db";
import { logAgent } from "../logger";
import { rankContent } from "../domain/content";
import type { ContentCategory, ContentLibraryItem } from "../types";

/**
 * Fetch active snippets in the given categories and rank them by how well their
 * tags match the opportunity. Returns at most `limit` items, or [] on any error.
 */
export async function retrieveRelevantContent(opts: {
  categories: ContentCategory[];
  tags: string[];
  limit?: number;
}): Promise<ContentLibraryItem[]> {
  if (opts.categories.length === 0) return [];
  try {
    const items = await query<ContentLibraryItem>(
      `select * from content_library
        where is_active = true and category = any($1)
        limit 200`,
      [opts.categories]
    );
    return rankContent(items, opts.tags, opts.limit ?? 3);
  } catch (err) {
    // Table missing (pre-migration) or any transient error: draft without it.
    await logAgent({
      agent: "content-library",
      action: "retrieve",
      level: "warn",
      status: "skipped",
      message: `Content library unavailable, drafting without reusable content: ${
        (err as Error).message
      }`,
    }).catch(() => {});
    return [];
  }
}

/**
 * Render retrieved snippets as a labeled prompt block the agents can inject. The
 * framing tells the model this is our own vetted, reusable language it may adapt,
 * while keeping the hard rule that it must not introduce facts beyond what it is
 * given. Returns null when there is nothing to inject (prompt stays baseline).
 */
export function renderContentForPrompt(items: ContentLibraryItem[]): string | null {
  if (items.length === 0) return null;
  const blocks = items.map(
    (i) => `- (${i.category}) ${i.title}:\n${i.body.trim()}`
  );
  return [
    "APPROVED REUSABLE CONTENT (our own pre-approved, vetted language, you MAY quote or adapt it where relevant; do NOT introduce any fact not present here or in the other material provided):",
    ...blocks,
  ].join("\n");
}
