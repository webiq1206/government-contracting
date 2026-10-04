/** Incidental queue triggers/options cannot reopen unresolved record work. */
export function agentWorkIdentity(agent: string, payload: Record<string, unknown>,
  pursuitVersion: number | null): { workKey: string; relatedId?: string } {
  const record = typeof payload.opportunityId === "string" ? ["opportunity",payload.opportunityId]
    : typeof payload.subcontractorId === "string" ? ["subcontractor",payload.subcontractorId] : null;
  if (record) record[1] = record[1].toLowerCase();
  return { workKey: JSON.stringify([agent,record ?? payload,pursuitVersion]),
    relatedId: record?.[1] };
}
