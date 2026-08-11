/**
 * Contactability rules for the subcontractor pipeline.
 * Automation (email outreach + phone calls) cannot run without a pathway.
 * We refuse to invent empty roster rows or queue uncallable work.
 */

function clean(s: string | null | undefined): string {
  return (s ?? "").trim();
}

/** At least one way to eventually reach them (email, phone, or website for research). */
export function hasContactPathway(input: {
  email?: string | null;
  phone?: string | null;
  website?: string | null;
}): boolean {
  return Boolean(clean(input.email) || clean(input.phone) || clean(input.website));
}

/** Can we dial them from the Call Queue today? */
export function isCallable(input: { phone?: string | null }): boolean {
  return Boolean(clean(input.phone));
}

/** Can Outreach send without drafting a dead-end message? */
export function isEmailable(input: {
  email?: string | null;
  email_verified?: boolean | null;
}): boolean {
  return Boolean(clean(input.email) && input.email_verified);
}

/**
 * Score bump for Places candidates that already expose a contact pathway.
 * Phone is strongest (calls work immediately); website enables email research.
 */
export function contactabilityBonus(input: {
  phone?: string | null;
  website?: string | null;
  email?: string | null;
}): number {
  let bonus = 0;
  if (clean(input.phone)) bonus += 25;
  if (clean(input.website)) bonus += 15;
  if (clean(input.email)) bonus += 20;
  return bonus;
}
