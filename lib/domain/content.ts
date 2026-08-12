/**
 * Content-library retrieval ranking, kept pure and unit-tested so what the AI
 * agents pull into a prompt is deterministic. Given a set of candidate snippets
 * and the tags that describe an opportunity (trades, agency, NAICS, keywords),
 * rank by tag overlap and return the best few. Snippets that match nothing are
 * dropped, so we never inject irrelevant content, and when the caller supplies
 * no tags we fall back to the most recently updated items.
 */
import type { ContentCategory, ContentLibraryItem } from "../types";

/**
 * Canonical snippet types. Labels are plain English for operators; `hint` is
 * the one-line "what is this for?" shown in the Content Library UI.
 */
export const CONTENT_CATEGORIES: {
  value: ContentCategory;
  label: string;
  hint: string;
}[] = [
  {
    value: "past_performance",
    label: "Past work write-ups",
    hint: "Short proof of jobs you or your subs already finished well. Pulled into proposals when an agency asks for experience.",
  },
  {
    value: "capability",
    label: "What we can do",
    hint: "Your company strengths, trades, and coverage in plain language. Used in capability statements and Sources Sought replies.",
  },
  {
    value: "win_theme",
    label: "Why choose us",
    hint: "The main reasons an agency should pick you (speed, local teams, quality). Repeated as themes across a bid.",
  },
  {
    value: "technical_approach",
    label: "How we will do the work",
    hint: "Reusable paragraphs about method, schedule, or quality control that the Bid Builder can drop into a technical narrative.",
  },
  {
    value: "boilerplate",
    label: "Standard company language",
    hint: "Legal name, about-us, certifications, and other copy you reuse almost every time.",
  },
];

const CATEGORY_VALUES = CONTENT_CATEGORIES.map((c) => c.value);

export interface ParsedContent {
  title: string;
  category: ContentCategory;
  content: string;
  tags: string[];
}

/**
 * Validate a create/update payload for a content-library snippet. Shared by the
 * POST and PATCH routes so the rules live in one tested place, and kept pure (no
 * DB) so it can be exported from a domain module rather than a route file.
 */
export function parseContentBody(
  body: unknown
): { ok: true; value: ParsedContent } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid body." };
  const b = body as Record<string, unknown>;
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const content = typeof b.body === "string" ? b.body.trim() : "";
  const category = (typeof b.category === "string" ? b.category : "") as ContentCategory;
  if (!title) return { ok: false, error: "Title is required." };
  if (!content) return { ok: false, error: "Content is required." };
  if (!CATEGORY_VALUES.includes(category)) return { ok: false, error: "Unknown category." };
  const tags = Array.isArray(b.tags)
    ? Array.from(
        new Set(
          b.tags
            .map((t) => (typeof t === "string" ? t.trim().toLowerCase() : ""))
            .filter(Boolean)
        )
      )
    : [];
  return { ok: true, value: { title, category, content, tags } };
}

/** Lowercase + trim a tag/keyword for case-insensitive comparison. */
function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Number of wanted tags that appear in the item's tag set (normalized). */
export function tagOverlap(itemTags: string[], wantedTags: string[]): number {
  if (wantedTags.length === 0) return 0;
  const want = new Set(wantedTags.map(norm).filter(Boolean));
  if (want.size === 0) return 0;
  const have = new Set((itemTags ?? []).map(norm).filter(Boolean));
  let n = 0;
  for (const t of want) if (have.has(t)) n++;
  return n;
}

/**
 * Rank candidate snippets for an opportunity. Only active items are considered.
 * With wanted tags, returns the highest-overlap items (overlap > 0), most
 * recently updated breaking ties. With no wanted tags, returns the most recent
 * active items. Never returns more than `limit`.
 */
export function rankContent(
  items: ContentLibraryItem[],
  wantedTags: string[],
  limit = 3
): ContentLibraryItem[] {
  const active = items.filter((i) => i.is_active);
  const recency = (i: ContentLibraryItem) =>
    i.updated_at ? new Date(i.updated_at).getTime() : 0;

  if (wantedTags.length === 0) {
    return [...active].sort((a, b) => recency(b) - recency(a)).slice(0, limit);
  }

  return active
    .map((i) => ({ item: i, score: tagOverlap(i.tags, wantedTags) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || recency(b.item) - recency(a.item))
    .slice(0, limit)
    .map((s) => s.item);
}
