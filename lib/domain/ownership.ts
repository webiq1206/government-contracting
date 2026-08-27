import type { Capability } from "@/lib/domain/roles";

/**
 * Who on the team a piece of work is on.
 *
 * The queue could already say when the next move belonged to somebody outside
 * the company: `waitingOn` covers the subcontractor who has not quoted and the
 * agency that has not answered. What it could not say is which of the three
 * people in this office is doing it.
 *
 * On a one-person account that question has an obvious answer and nobody asks
 * it. On a five-person account it is the question, and its absence has a
 * specific failure mode: everything looks like it is on everybody, so the
 * items that go overdue are exactly the ones each person assumed the other had
 * picked up.
 */

export interface Owner {
  id: string;
  /** What to call them on screen. Never an email, never an id. */
  name: string;
}

/**
 * The three answers to "whose is this".
 *
 * `unassigned` is a real answer and the honest default. It is not the same as
 * "we do not know", which is why nothing here ever guesses: an account's owner
 * is not the owner of every record in it merely because they signed up.
 */
export const OWNER_FILTERS = ["anyone", "mine", "unassigned"] as const;
export type OwnerFilter = (typeof OWNER_FILTERS)[number];

export const OWNER_FILTER_LABEL: Record<OwnerFilter, string> = {
  anyone: "Anyone",
  mine: "On me",
  unassigned: "Unassigned",
};

/**
 * Fails wide.
 *
 * An unrecognised value shows everything rather than nothing. A filter that
 * fails closed on a typo hides work, and hidden work on this page is a missed
 * deadline; a filter that fails wide shows too much, which a person can see
 * and correct.
 */
export function parseOwnerFilter(raw: string | string[] | undefined): OwnerFilter {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (OWNER_FILTERS as readonly string[]).includes(v ?? "") ? (v as OwnerFilter) : "anyone";
}

/**
 * What the row says.
 *
 * "Unassigned" rather than a blank, because a blank in an owner column reads
 * as a rendering fault and gets ignored, where the word is a state somebody
 * can act on.
 */
export function describeOwner(owner: Owner | null | undefined, viewerId?: string): string {
  if (!owner) return "Unassigned";
  if (viewerId && owner.id === viewerId) return "You";
  return owner.name;
}

/**
 * A person's display name, from what the account actually holds.
 *
 * Falls back to the local part of the email rather than to the whole address:
 * a queue row reading "someone@contractorco.com" is an address where a name
 * should be, and on a shared screen it is an address being shown to whoever
 * walks past. Never an id, and never empty.
 */
export function ownerName(user: { name?: string | null; email?: string | null }): string {
  const named = user.name?.trim();
  if (named) return named;
  const local = user.email?.split("@")[0]?.trim();
  if (local) return local;
  return "A teammate";
}

/**
 * Who may change an assignment.
 *
 * Assigning work is not an administrative act: it is how a team divides a
 * morning, and requiring an administrator for it would mean the person who
 * picked something up cannot say so. Anyone who can act on the record can say
 * whose it is.
 *
 * The one thing this does not permit is assigning to somebody who is not in
 * the organization, and that is enforced in the database rather than here,
 * because a check that lives only in a form is one an API call walks past.
 */
export function canAssign(capabilities: readonly Capability[]): boolean {
  return capabilities.includes("view") && capabilities.length > 1;
}

/**
 * Does this record match the filter.
 *
 * Pure, so the same rule serves a SQL where-clause's expectations and an
 * in-memory list, and the two cannot drift into disagreeing about what "on me"
 * means.
 */
export function matchesOwner(
  owner: Owner | null | undefined,
  filter: OwnerFilter,
  viewerId: string
): boolean {
  if (filter === "anyone") return true;
  if (filter === "unassigned") return !owner;
  return owner?.id === viewerId;
}
