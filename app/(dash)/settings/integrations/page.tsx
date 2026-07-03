import { integrationStatus, config } from "@/lib/config";
import { PageHeader } from "@/components/badges";

export const dynamic = "force-dynamic";

interface IntegrationDef {
  key: keyof ReturnType<typeof integrationStatus>;
  label: string;
  hint: string;
}

const INTEGRATIONS: IntegrationDef[] = [
  { key: "database", label: "Database (Postgres/Supabase)", hint: "DATABASE_URL" },
  { key: "claude", label: "Claude (Anthropic)", hint: "ANTHROPIC_API_KEY" },
  { key: "sam", label: "SAM.gov", hint: "SAM_API_KEY" },
  { key: "usaspending", label: "USASpending", hint: "Public API — no key required" },
  { key: "bls", label: "Bureau of Labor Statistics", hint: "Works unauthenticated at low volume" },
  { key: "googleMaps", label: "Google Maps", hint: "GOOGLE_MAPS_API_KEY" },
  { key: "hunter", label: "Hunter.io", hint: "HUNTER_API_KEY" },
  { key: "gmail", label: "Gmail", hint: "GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET" },
  { key: "twilio", label: "Twilio (SMS)", hint: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER" },
  { key: "resend", label: "Resend (email)", hint: "RESEND_API_KEY" },
  { key: "supabaseStorage", label: "Supabase Storage", hint: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
];

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams?: { gmail?: string };
}) {
  const status = integrationStatus();
  const gmailParam = searchParams?.gmail;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Integrations"
        subtitle="Informational only — no secrets are ever displayed."
      />

      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-5">
        {gmailParam === "connected" && (
          <div className="card border-pursue/40 bg-pursue/5 text-sm text-pursue">
            Gmail connected successfully.
          </div>
        )}
        {gmailParam === "denied" && (
          <div className="card border-review/40 bg-review/5 text-sm text-review">
            Gmail connection was denied. You can retry the connection below.
          </div>
        )}
        {gmailParam === "error" && (
          <div className="card border-risk/40 bg-risk/5 text-sm text-risk">
            Gmail connection failed. Check GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET and try again.
          </div>
        )}

        <div className="card p-0">
          <table className="w-full">
            <tbody>
              {INTEGRATIONS.map((it) => {
                const connected = Boolean(status[it.key]);
                return (
                  <tr key={it.key as string} className="border-b border-ink-800/60 last:border-b-0">
                    <td className="td">
                      <p className="font-medium text-slate-100">{it.label}</p>
                      <p className="mt-0.5 font-mono text-xs text-slate-500">{it.hint}</p>
                    </td>
                    <td className="td w-40 text-right align-middle">
                      {connected ? (
                        <span className="badge bg-pursue/15 text-pursue">Connected</span>
                      ) : (
                        <span className="badge bg-ink-700 text-slate-400">Not configured</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Gmail connect flow: configured (env present) but not yet OAuth-linked */}
        {!status.gmail && config.gmail.configured && (
          <div className="card flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-100">Connect your Gmail account</p>
              <p className="mt-0.5 text-xs text-slate-400">
                Credentials are configured. Complete the OAuth flow to send and read mail.
              </p>
            </div>
            <a href="/api/integrations/gmail/connect" className="btn-primary">
              Connect Gmail
            </a>
          </div>
        )}

        <div className="card flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-100">Job queue backend</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {status.queue === "bullmq"
                ? "BullMQ (Redis-backed) — REDIS_URL is set."
                : "pg-boss (Postgres-backed) — set REDIS_URL to switch to BullMQ."}
            </p>
          </div>
          <span className="badge bg-brand-600/15 font-mono text-brand-400">{status.queue}</span>
        </div>
      </div>
    </div>
  );
}
