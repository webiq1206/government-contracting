/**
 * One line for the daily recap: healthy, a held refusal, or the last probe.
 */
export interface ProviderStatusFact {
  provider: string;
  refusalReason: string | null;
  heldSince: string | null;
  nextProbeAt: string | null;
  lastProbeAt: string | null;
  /** Null when no probe has run. */
  lastProbeOk: boolean | null;
}

export function providerStatusLine(rows: readonly ProviderStatusFact[]): string {
  if (rows.length === 0) return "AI providers: status was not recorded.";
  return `AI providers: ${rows.map(lineFor).join(" ")}`;
}

function lineFor(row: ProviderStatusFact): string {
  if (row.refusalReason) {
    const since = row.heldSince ? ` since ${row.heldSince}` : "";
    const next = row.nextProbeAt
      ? ` Next probe at ${row.nextProbeAt}.`
      : " Next probe has not been scheduled.";
    return `${row.provider}: refusal held${since}.${next}`;
  }
  if (row.lastProbeAt && row.lastProbeOk === true) {
    return `${row.provider}: healthy. Last probe at ${row.lastProbeAt} succeeded.`;
  }
  if (row.lastProbeAt && row.lastProbeOk === false) {
    return `${row.provider}: healthy. Last probe at ${row.lastProbeAt} did not succeed.`;
  }
  return `${row.provider}: healthy.`;
}
