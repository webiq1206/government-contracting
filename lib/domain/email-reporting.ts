/** Shared predicates for recap queries. The alias is fixed by the caller. */
export function failedEmailSql(alias = "c"): string {
  return `${alias}.direction = 'outbound' and ${alias}.channel = 'email'
    and ${alias}.delivery_state is distinct from 'draft'
    and (${alias}.delivery_state in ('bounced', 'failed') or ${alias}.provider is null)`;
}

/** A provider handoff is a send; it is not proof of recipient delivery. */
export function sentEmailSql(alias = "c"): string {
  return `${alias}.direction = 'outbound' and ${alias}.channel = 'email'
    and ${alias}.provider is not null
    and ${alias}.delivery_state in ('sent', 'delivered', 'bounced', 'deferred')`;
}
