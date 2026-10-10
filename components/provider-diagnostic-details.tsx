import { configurationReference, providerDiagnostics } from "@/lib/api-usage/diagnostics";

/** Admin-only caller; readUsage never includes these fields in tenant JSON. */
export function ProviderDiagnosticDetails({ diagnostics, configuration }: { diagnostics: unknown; configuration: unknown }) {
  if (!diagnostics) return <p className="my-3 text-sm text-muted-foreground">Structured provider diagnostics were not recorded for this request. Its historical cause cannot be reconstructed from HTTP status alone.</p>;
  const d = providerDiagnostics({ diagnostics });
  const c = configurationReference(configuration);
  const stores = { platform_settings: "Saved platform settings", platform_environment: "Platform deployment environment", tenant_settings: "Saved tenant settings", unknown: "Not recorded" };
  const missing = (key: string) => d.omittedFields.includes(key) ? "Omitted by privacy filter" : "Not recorded";
  return <section className="my-4 border-t pt-4" aria-label="Saved provider diagnostics">
    <h3 className="font-semibold">Saved provider diagnostics</h3>
    <dl className="mt-2 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
      {Object.entries({
        "HTTP status": d.httpStatus ?? "Not recorded",
        "Provider error code": d.errorCode ?? missing("errorCode"),
        "Provider error type": d.errorType ?? missing("errorType"),
        "Provider request ID": d.requestId ?? missing("requestId"),
        "Retry-After": d.retryAfterSeconds == null ? missing("retryAfterSeconds") : `${d.retryAfterSeconds} seconds (at response time)`,
        "Credential configuration": stores[c.credentialStore],
        "Configuration owner (BrostCo account)": c.settingsOrgId ?? "Not recorded",
        "Credential setting": c.credentialSetting ?? "Not recorded",
        "Provider billing account": "Not recorded",
      }).map(([label, value]) => <div className="min-w-0 break-words" key={label}><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>)}
    </dl>
    <p className="mt-3 text-sm text-muted-foreground">The configuration reference identifies the matched application configuration, not a verified provider billing account. Matching a platform credential takes precedence for billing. This records evidence at the request time and does not establish the current connection. No new provider check was run.</p>
  </section>;
}
