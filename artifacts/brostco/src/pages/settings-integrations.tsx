import { useGetIntegrationStatus } from "@workspace/api-client-react";
import { PageHeader } from "@/components/badges";

type StatusMap = {
  database: boolean;
  claude: boolean;
  sam: boolean;
  usaspending: boolean;
  bls: boolean;
  googleMaps: boolean;
  hunter: boolean;
  gmail: boolean;
  twilio: boolean;
  resend: boolean;
  supabaseStorage: boolean;
  queue: string;
};

const INTEGRATIONS: { key: keyof StatusMap; label: string; description: string; required: boolean }[] = [
  { key: "database", label: "PostgreSQL Database", description: "Core data store for all platform data.", required: true },
  { key: "claude", label: "Anthropic Claude", description: "Powers the Scoring Engine, Solicitation Analyst, and Call Prep agent. Set ANTHROPIC_API_KEY.", required: true },
  { key: "sam", label: "SAM.gov API", description: "Opportunity discovery. Set SAM_API_KEY (free at api.data.gov).", required: true },
  { key: "usaspending", label: "USASpending.gov", description: "Past performance lookup. Public API — no key required.", required: false },
  { key: "bls", label: "BLS PPI Data", description: "Material cost escalation for bid pricing. Public API.", required: false },
  { key: "googleMaps", label: "Google Maps API", description: "Business verification and location scoring. Set GOOGLE_MAPS_API_KEY.", required: false },
  { key: "hunter", label: "Hunter.io", description: "Email verification for subcontractor outreach. Set HUNTER_API_KEY.", required: false },
  { key: "gmail", label: "Gmail / SMTP", description: "Sub outreach emails. Set GMAIL_REFRESH_TOKEN, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET.", required: false },
  { key: "twilio", label: "Twilio SMS", description: "SMS outreach to subcontractors. Set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN.", required: false },
  { key: "resend", label: "Resend", description: "Transactional email alternative to Gmail. Set RESEND_API_KEY.", required: false },
  { key: "supabaseStorage", label: "Supabase Storage", description: "Solicitation document storage. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.", required: false },
];

function IntegrationRow({ status, label, description, required }: { status: boolean | string; label: string; description: string; required: boolean }) {
  const connected = typeof status === "boolean" ? status : !!status;
  return (
    <tr className="border-b border-ink-800/40 last:border-0">
      <td className="td">
        <p className="text-sm font-medium text-slate-100">{label}</p>
        <p className="text-xs text-slate-500">{description}</p>
      </td>
      <td className="td w-32 text-right">
        {required && !connected && <span className="mr-2 text-xs text-risk">required</span>}
        <span className={`badge ${connected ? "bg-pursue/15 text-pursue" : "bg-ink-700 text-slate-400"}`}>
          {connected ? "✓ Connected" : "Not configured"}
        </span>
      </td>
    </tr>
  );
}

export default function SettingsIntegrationsPage() {
  const { data } = useGetIntegrationStatus();
  const status = (data as StatusMap | undefined) ?? {} as StatusMap;

  const missing = INTEGRATIONS.filter((i) => i.required && !status[i.key]).length;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Integrations"
        subtitle={missing > 0 ? `${missing} required integration${missing === 1 ? "" : "s"} not configured.` : "All required integrations connected."}
      />
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-5">
        {status.queue && (
          <div className="rounded-md border border-ink-700 bg-ink-900/60 px-3 py-2 text-sm text-slate-300">
            Job queue: <span className="font-mono text-brand-400">{status.queue}</span>
          </div>
        )}
        <div className="card overflow-hidden p-0">
          <table className="w-full border-collapse">
            <thead className="border-b border-ink-800 bg-ink-900/60">
              <tr>
                <th className="th">Integration</th>
                <th className="th w-32 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {INTEGRATIONS.map((i) => (
                <IntegrationRow
                  key={i.key}
                  status={status[i.key] ?? false}
                  label={i.label}
                  description={i.description}
                  required={i.required}
                />
              ))}
            </tbody>
          </table>
        </div>
        <div className="card bg-ink-950/60 text-sm text-slate-400">
          <p className="mb-2 font-medium text-slate-200">Adding environment variables</p>
          <p>Set variables in the Replit Secrets panel (🔒 icon in the sidebar) or in your <code>.env</code> file. Restart the API server after adding new secrets.</p>
        </div>
      </div>
    </div>
  );
}
