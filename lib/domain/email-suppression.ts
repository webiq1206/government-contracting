/**
 * Do-not-contact: the list of addresses this organization may not email.
 *
 * Enforced at the single send chokepoint rather than at each of the seven call
 * sites, because the one that gets forgotten is the one that mails somebody
 * who asked us to stop. Repeated mail after an opt-out is what produces spam
 * complaints, and complaints are what move a whole sending domain into the
 * spam folder for every tenant at once.
 *
 * Everything here is org-scoped: each tenant is a separate sender with its own
 * relationship and its own obligation, so one tenant's opt-out is neither the
 * other's to honour nor the other's to read.
 */
import { query, queryOne } from "../db";

export type SuppressionSource = "reply" | "operator" | "bounce";

/** True when this organization is forbidden from emailing this address. */
export async function isSuppressed(orgId: string, email: string): Promise<boolean> {
  const addr = email.trim().toLowerCase();
  if (!addr) return false;
  const row = await queryOne<{ id: string }>(
    `select id from email_suppressions where org_id = $1 and lower(email) = $2`,
    [orgId, addr]
  ).catch(() => null);
  return Boolean(row);
}

/**
 * Add an address to this organization's do-not-contact list.
 *
 * Idempotent: asking twice keeps the FIRST reason and timestamp, because that
 * is the moment the request was actually made and it is the one an audit
 * cares about.
 */
export async function suppressEmail(input: {
  orgId: string;
  email: string;
  reason?: string;
  source?: SuppressionSource;
}): Promise<void> {
  const addr = input.email.trim().toLowerCase();
  if (!addr) return;
  await query(
    `insert into email_suppressions (org_id, email, reason, source)
     values ($1,$2,$3,$4)
     on conflict (org_id, lower(email)) do nothing`,
    [input.orgId, addr, input.reason ?? null, input.source ?? "operator"]
  );
}

/** Remove an address, e.g. the operator confirms the contact opted back in. */
export async function unsuppressEmail(orgId: string, email: string): Promise<void> {
  await query(`delete from email_suppressions where org_id=$1 and lower(email)=$2`, [
    orgId,
    email.trim().toLowerCase(),
  ]);
}

/**
 * Does this reply text read as "stop emailing me"?
 *
 * Deliberately narrow. A false positive silently stops a live negotiation, so
 * this matches explicit opt-out language only and leaves anything ambiguous to
 * a person. "Not interested in this one" is a decline, not an opt-out, and
 * must NOT match: declining a single solicitation is normal and they should
 * still hear about the next.
 */
export function readsAsOptOut(text: string): boolean {
  const t = (text ?? "").toLowerCase().replace(/\s+/g, " ");
  if (!t) return false;
  return [
    /\b(un)?subscribe me\b/,
    /\bunsubscribe\b/,
    /\bremove me from\b/,
    /\btake me off\b/,
    /\bstop (emailing|contacting|sending)\b/,
    /\bdo not (email|contact) me\b/,
    /\bdon'?t (email|contact) me (again|any ?more)\b/,
    /\bno longer wish to (receive|be contacted)\b/,
    /\bopt me out\b/,
  ].some((re) => re.test(t));
}
