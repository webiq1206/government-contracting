import { LEGACY_ORG_ID } from "../tenant-context";

export const BROSTCO_MAIL_SIGNATURE = "BrostCo\nProcurement & Project Coordination\nhello@brostco.com\nhttps://brostco.com";

/** Render only for the founding account's selected branded identity. */
export function withMailSignature(text: string, orgId: string, from: string): string {
  const address = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
  if (orgId !== LEGACY_ORG_ID || address !== "hello@brostco.com" || text.includes(BROSTCO_MAIL_SIGNATURE)) return text;
  return `${text.trimEnd()}\n\n${BROSTCO_MAIL_SIGNATURE}`;
}
