/**
 * Saved views: whose they are, and what a name may be.
 *
 * Two kinds, and the difference is the whole design. A personal view is
 * somebody's own shortcut. A team view is how an office agrees on what "the
 * work" means this month, and it is useless if it exists only in the browser
 * of the person who made it.
 *
 * Pure, so the same rules serve the API and the form and cannot drift into a
 * name the interface accepts and the server rejects.
 */

export const VIEW_SCOPES = ["personal", "team"] as const;
export type ViewScope = (typeof VIEW_SCOPES)[number];

/**
 * Fails to personal.
 *
 * An unrecognised scope must not become a team view. Getting this wrong in the
 * safe direction saves a shortcut where only its author can see it; getting it
 * wrong the other way puts one person's filter in front of everybody with no
 * way for them to tell where it came from.
 */
export function parseScope(raw: unknown): ViewScope {
  return raw === "team" ? "team" : "personal";
}

export interface SavedViewRecord {
  id: string;
  name: string;
  query: string;
  scope: ViewScope;
  /** Who made it. Shown on team views so a colleague knows whose filter it is. */
  createdBy: string | null;
  /** True when the reader may delete it. */
  canDelete: boolean;
}

export const NAME_MAX = 60;

export type NameProblem = "empty" | "too_long";

/**
 * A name a person can find again.
 *
 * Trimmed, non-empty, and short enough to render in a chip. Nothing clever:
 * the point is that the same answer comes back from the form and from the
 * endpoint, so a name that looks accepted is accepted.
 */
export function checkViewName(raw: string): { ok: true; name: string } | { ok: false; problem: NameProblem } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length === 0) return { ok: false, problem: "empty" };
  if (name.length > NAME_MAX) return { ok: false, problem: "too_long" };
  return { ok: true, name };
}

export const NAME_PROBLEM_MESSAGE: Record<NameProblem, string> = {
  empty: "Give the view a name you will recognise later.",
  too_long: `Keep it under ${NAME_MAX} characters so it fits in the bar.`,
};

/**
 * Who may delete a saved view.
 *
 * Its author always may. A team view may also be removed by somebody who
 * administers the account, because a shared filter whose author has left is
 * otherwise permanent. A personal view is nobody else's business, including an
 * administrator's: it is a shortcut, not a record.
 */
export function canDeleteView(
  view: { scope: ViewScope; ownerId: string | null; createdBy: string | null },
  viewer: { id: string; canManageTeam: boolean }
): boolean {
  if (view.ownerId === viewer.id || view.createdBy === viewer.id) return true;
  return view.scope === "team" && viewer.canManageTeam;
}
