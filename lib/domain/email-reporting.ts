/**
 * Shared predicates for every surface that counts outbound email.
 *
 * Four pages used to carry four different definitions of "did not arrive",
 * and the daily recap reported ten emails sent and ten that did not arrive
 * on a day when nothing had actually failed: the rows were approaches held
 * back on purpose (a suppressed address, a paused mailbox), written as
 * `failed` with no provider, and read back as mail that vanished. The alias
 * is fixed by the caller.
 */

/** Refused by the recipient's server after a real handoff. */
export function bouncedEmailSql(alias = "c"): string {
  return `${alias}.direction = 'outbound' and ${alias}.channel = 'email'
    and ${alias}.provider is not null
    and ${alias}.delivery_state = 'bounced'`;
}

/**
 * A send that was attempted and did not leave: the provider refused it, or
 * the row claims a send with no provider to show for it. Deliberate holds
 * (`draft`, `held`) are not failures and are excluded.
 */
export function neverSentEmailSql(alias = "c"): string {
  return `${alias}.direction = 'outbound' and ${alias}.channel = 'email'
    and ${alias}.delivery_state not in ('draft', 'held')
    and (${alias}.delivery_state = 'failed' or ${alias}.provider is null)`;
}

/** Everything the recipient did not get and somebody should look at. */
export function failedEmailSql(alias = "c"): string {
  return `(${bouncedEmailSql(alias)}) or (${neverSentEmailSql(alias)})`;
}

/** A provider handoff is a send; it is not proof of recipient delivery. */
export function sentEmailSql(alias = "c"): string {
  return `${alias}.direction = 'outbound' and ${alias}.channel = 'email'
    and ${alias}.provider is not null
    and ${alias}.delivery_state in ('sent', 'delivered', 'bounced', 'deferred')`;
}

/** Positive evidence the recipient got it: opened, clicked, or replied. */
export function deliveredEmailSql(alias = "c"): string {
  return `${alias}.direction = 'outbound' and ${alias}.channel = 'email'
    and ${alias}.provider is not null
    and (${alias}.delivery_state = 'delivered'
      or ${alias}.opened_at is not null
      or ${alias}.clicked_at is not null
      or ${alias}.replied_at is not null)`;
}

/**
 * The caveat under an "emails sent" figure. Bounces are inside the sent
 * total (they were handed over); never-sent rows are not. Saying "10 sent,
 * 10 did not arrive" for a day of ten bounces and a day of ten held sends
 * alike is what this replaces.
 */
export function undeliveredNote(bounced: number, neverSent: number): string | undefined {
  const parts: string[] = [];
  if (bounced > 0) parts.push(`${bounced} bounced`);
  if (neverSent > 0) parts.push(`${neverSent} never left`);
  return parts.length > 0 ? parts.join(", ") : undefined;
}
