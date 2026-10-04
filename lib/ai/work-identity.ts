/** Incidental queue triggers/options cannot reopen unresolved record work. */
export function agentWorkIdentity(agent: string, payload: Record<string, unknown>,
  pursuitVersion: number | null): { workKey: string; relatedId?: string } {
  const record = typeof payload.opportunityId === "string" ? ["opportunity",payload.opportunityId]
    : typeof payload.subcontractorId === "string" ? ["subcontractor",payload.subcontractorId] : null;
  if (record) {
    const compact = record[1].trim().replace(/^\{|\}$/g, "").replace(/-/g, "").toLowerCase();
    if (/^[0-9a-f]{32}$/.test(compact)) {
      record[1] = `${compact.slice(0,8)}-${compact.slice(8,12)}-${compact.slice(12,16)}-${compact.slice(16,20)}-${compact.slice(20)}`;
    }
  }
  return { workKey: JSON.stringify([agent,record ?? payload,pursuitVersion]),
    relatedId: record?.[1] };
}
