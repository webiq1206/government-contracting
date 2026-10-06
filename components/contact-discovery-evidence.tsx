/** Saved provenance only. Viewing this never performs research or verification. */
export function ContactDiscoveryEvidence({ verification }: { verification?: Record<string, unknown> | null }) {
  const raw = verification?.email_discovery;
  const evidence = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  const text = (key: string) => typeof evidence?.[key] === "string" ? evidence[key] as string : null;
  let source: string | null = null;
  try { const url = new URL(text("source_url") ?? ""); if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) source = url.href; } catch { /* Older evidence may have no URL. */ }
  const checked = text("checked_at");
  const date = checked ? new Date(checked) : null;
  return <details className="mt-2 rounded border border-border/60 p-3 text-sm">
    <summary className="min-h-11 cursor-pointer font-medium">Where this email was found</summary>
    {!evidence ? <p className="text-muted-foreground">No public email discovery source was saved for this pairing. A saved address alone does not establish its source or verification.</p> : <div className="space-y-2 [overflow-wrap:anywhere]">
      <p>Address found: {text("email") ?? "Not recorded"}</p>
      <p>Source: {text("source_type") === "linked_social" ? "Public profile linked from the business website" : text("source_type") === "website" ? "Business website" : "Source type not recorded"}</p>
      {source ? <a className="inline-flex min-h-11 items-center text-accent underline" href={source} target="_blank" rel="noopener noreferrer">Open saved source page</a> : <p>Source page not recorded.</p>}
      <p>Checked: {date && Number.isFinite(date.getTime()) ? date.toISOString().replace("T", " ").replace(".000Z", " UTC") : "Time not recorded"}</p>
      <p className="text-muted-foreground">Discovery records where an address was published. It does not confirm that the address is usable or that a message was sent. Check the current contact status and message history.</p>
    </div>}
  </details>;
}
