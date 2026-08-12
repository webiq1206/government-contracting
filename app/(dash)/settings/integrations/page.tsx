import { config, integrationStatus } from "@/lib/config";
import { PageHeader } from "@/components/badges";
import { PAGE_HELP } from "@/lib/help-content";
import { IntegrationManager } from "@/components/integration-manager";
import { EditorialTabs } from "@/components/editorial-tabs";
import { hydrateIntegrationEnv, settingSources } from "@/lib/integration-settings";
import { INTEGRATION_DEFS } from "@/lib/integration-defs";
import { gmail } from "@/lib/integrations/gmail";

const CORE_IDS = new Set(["sam", "claude"]);
const OUTREACH_IDS = new Set(["gmail", "resend", "twilio", "hunter"]);
const DATA_IDS = new Set([
  "googleMaps",
  "ahrefs",
  "bls",
  "supabaseStorage",
  "usaspending",
]);

export const dynamic = "force-dynamic";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams?: { gmail?: string };
}) {
  await hydrateIntegrationEnv();
  const [sources, gmailConnected] = await Promise.all([
    settingSources(),
    gmail.isConnected().catch(() => false),
  ]);
  const status = integrationStatus();
  const gmailParam = searchParams?.gmail;
  const resendOutreachActive = !gmailConnected && config.resend.enabled;

  const initial = INTEGRATION_DEFS.map((def) => {
    // When Resend is carrying outreach, the Gmail card's "no outreach" warning
    // is wrong; say what is actually happening instead.
    const without =
      def.id === "gmail" && resendOutreachActive
        ? `Outreach and follow-ups are sending via Resend from ${config.resend.outreachFrom}.` +
          (config.resend.inboundEnabled
            ? " Reply detection and price capture run through the Resend inbound webhook."
            : " Connect Gmail (or add the Resend inbound webhook secret) to enable reply detection and automatic price capture.")
        : def.without;
    const fields = def.fields.map((f) => ({
      ...f,
      ...(sources[f.env] ?? { source: "none" as const, masked: null }),
    }));
    const required = fields.filter((f) => !f.label.includes("optional"));
    const configured =
      def.id === "usaspending" ||
      (required.length > 0 && required.every((f) => f.source !== "none"));
    return {
      ...def,
      without,
      fields,
      configured: def.id === "gmail" ? gmailConnected || configured : configured,
      gmailConnected: def.id === "gmail" ? gmailConnected : undefined,
      last_error: fields.map((f) => f.last_error).find(Boolean) ?? null,
      last_validated_at:
        fields
          .map((f) => f.last_validated_at)
          .filter(Boolean)
          .sort()
          .pop() ?? null,
    };
  });

  const configuredCount = initial.filter((i) => i.configured).length;

  return (
    <>
      <PageHeader
        help={PAGE_HELP["integrations"]}
        title="Integrations"
        status={`${configuredCount} of ${initial.length} connected`}
        subtitle="Connect the services that power automation. Paste a key, press Test to verify live, then Save."
      />

      {(gmailParam === "connected" ||
        gmailParam === "denied" ||
        gmailParam === "error" ||
        resendOutreachActive) && (
        <div className="shrink-0 space-y-3 border-b border-border px-5 py-4 sm:px-6">
          {gmailParam === "connected" && (
            <div className="card border-pursue/40 bg-pursue/5 text-sm text-pursue">
              Gmail connected successfully. Outreach emails can now send.
            </div>
          )}
          {gmailParam === "denied" && (
            <div className="card border-review/40 bg-review/5 text-sm text-review">
              Gmail connection was denied. You can retry below.
            </div>
          )}
          {resendOutreachActive && (
            <div className="card border-accent/40 bg-accent-soft/60 text-sm text-accent-strong">
              Subcontractor outreach is sending via <strong>Resend</strong> from{" "}
              {config.resend.outreachFrom}.{" "}
              {config.resend.inboundEnabled
                ? "Replies are captured automatically through the Resend inbound webhook (prices are extracted and saved to the record)."
                : "Reply detection and automatic price capture need Gmail connected or the Resend inbound webhook configured (add the webhook signing secret below)."}{" "}
              Make sure the sender domain is verified in Resend, or sends will fail.
            </div>
          )}
          {gmailParam === "error" && (
            <div className="card border-risk/40 bg-risk/5 text-sm text-risk">
              Gmail connection failed. Check the OAuth client ID and secret below, then try again.
            </div>
          )}
        </div>
      )}

      <EditorialTabs
        ariaLabel="Integration groups"
        defaultTab="core"
        layout="fill"
        hashAliases={{
          sam: "core",
          claude: "core",
          gmail: "outreach",
          resend: "outreach",
          twilio: "outreach",
          hunter: "outreach",
          maps: "data",
          googleMaps: "data",
        }}
        tabs={[
          {
            id: "core",
            label: "Core",
            content: (
              <div className="space-y-4 px-5 py-6 sm:px-6">
                <p className="text-sm text-muted-foreground">
                  Required for intake and scoring. Without these, the pipeline stays empty.
                </p>
                <IntegrationManager
                  initial={initial.filter((i) => CORE_IDS.has(i.id))}
                />
                <div className="card flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Job queue backend</p>
                    <p className="mt-0.5 text-xs text-slate-600">
                      {status.queue === "bullmq"
                        ? "BullMQ (Redis-backed). REDIS_URL is set."
                        : "pg-boss (Postgres-backed). Set REDIS_URL in the environment to switch to BullMQ."}
                    </p>
                  </div>
                  <span className="badge bg-accent/10 font-mono text-accent">
                    {status.queue}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Values saved here are encrypted before they reach the database, shown only as a
                  masked preview, and take effect immediately (the background worker refreshes within
                  5 minutes). Environment variables still work as a fallback; a value saved on this
                  page takes priority over its environment variable.
                </p>
              </div>
            ),
          },
          {
            id: "outreach",
            label: "Outreach",
            content: (
              <div className="space-y-4 px-5 py-6 sm:px-6">
                <p className="text-sm text-muted-foreground">
                  Email, SMS, and contact enrichment for subcontractor outreach.
                </p>
                <IntegrationManager
                  initial={initial.filter((i) => OUTREACH_IDS.has(i.id))}
                />
              </div>
            ),
          },
          {
            id: "data",
            label: "Data",
            content: (
              <div className="space-y-4 px-5 py-6 sm:px-6">
                <p className="text-sm text-muted-foreground">
                  Optional enrichment: maps, SEO, labor data, and file storage.
                </p>
                <IntegrationManager
                  initial={initial.filter((i) => DATA_IDS.has(i.id))}
                />
              </div>
            ),
          },
        ]}
      />
    </>
  );
}
