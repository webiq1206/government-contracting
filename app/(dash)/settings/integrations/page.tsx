import { config, integrationStatus } from "@/lib/config";
import { orgIntegrationStatus } from "@/lib/integration-keys";
import { PageFrame } from "@/components/page-frame";
import { ReadOnlyBanner } from "@/components/permission-gate";
import { PAGE_HELP } from "@/lib/help-content";
import { IntegrationManager } from "@/components/integration-manager";
import { GoogleInboxCard } from "@/components/google-inbox-card";
import { EditorialTabs } from "@/components/editorial-tabs";
import { hydrateIntegrationEnv, settingSources } from "@/lib/integration-settings";
import { INTEGRATION_DEFS } from "@/lib/integration-defs";
import { recentAiTrouble, troubleSummary } from "@/lib/integration-health";
import { gmail } from "@/lib/integrations/gmail";
import { integrationState } from "@/lib/domain/integration-state";

const CORE_IDS = new Set(["sam", "claude"]);
const OUTREACH_IDS = new Set(["gmail", "twilio", "hunter"]);
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
  searchParams?: { gmail?: string; gmailError?: string };
}) {
  await hydrateIntegrationEnv();
  const [sources, inbox, aiTrouble] = await Promise.all([
    settingSources(),
    gmail
      .connection()
      .catch(() => ({ connected: false, email: null, status: "none", lastError: null })),
    // "Connected" here has only ever meant "a key is saved". It said so
    // through a day in which Anthropic refused every request for want of
    // credits, which is the one day it mattered.
    recentAiTrouble().catch(() => ({ count: 0, reason: null })),
  ]);
  const gmailConnected = inbox.connected;
  // Platform-owned integrations (our Ahrefs, our document storage) are hidden
  // from customers: a field they can fill that changes nothing for them is
  // worse than no field at all.
  const { isPlatformAdmin } = await import("@/lib/platform-admin");
  const { currentUser } = await import("@/lib/auth");
  const viewer = await currentUser().catch(() => null);
  const showPlatformOnly = isPlatformAdmin(viewer?.email);
  const status = { ...integrationStatus(), ...(await orgIntegrationStatus()) };
  const gmailParam = searchParams?.gmail;
  const gmailError = searchParams?.gmailError;

  const initial = INTEGRATION_DEFS.filter(
    (def) => showPlatformOnly || !def.platformOnly
  ).map((def) => {
    const without = def.without;
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
      last_error:
        (def.id === "claude" ? troubleSummary(aiTrouble) : null) ??
        fields.map((f) => f.last_error).find(Boolean) ??
        null,
      last_validated_at:
        fields
          .map((f) => f.last_validated_at)
          .filter(Boolean)
          .sort()
          .pop() ?? null,
    };
  }).map((def) => {
    /*
     * The state, decided once here rather than by the card. The card used to
     * do it inline as `last_error ? "Error" : configured ? "Connected" : ...`,
     * which is three outcomes for a question with six answers, and the middle
     * one was a claim the page could not support.
     */
    const verdict = integrationState(
      {
        configured: def.configured,
        lastError: def.last_error,
        lastValidatedAt: def.last_validated_at,
        // Only the OAuth one has a connection that can lapse. Undefined for
        // the key-based integrations, which have nothing to expire.
        connectionLive: def.id === "gmail" ? gmailConnected : undefined,
      }
    );
    return { ...def, state: verdict.state, stateReason: verdict.reason, stateAction: verdict.nextAction };
  });

  /*
   * Counted by what is working, not by what is saved. "5 of 7 configured" was
   * the same claim the badge made, one level up.
   */
  const workingCount = initial.filter((i) => i.state === "healthy").length;
  const troubleCount = initial.filter(
    (i) => i.state === "blocked" || i.state === "expired" || i.state === "degraded"
  ).length;

  return (
    <>
      <PageFrame
        help={PAGE_HELP["integrations"]}
        title="Integrations"
        status={
          troubleCount > 0
            ? `${troubleCount} need attention · ${workingCount} of ${initial.length} confirmed working`
            : `${workingCount} of ${initial.length} confirmed working`
        }
        explanation="Connect the services automation depends on. A key that is stored is not the same as a key that works, so each one shows when it was last used successfully."
        breadcrumbs={[{ label: "Settings", href: "/settings" }]}
      />

      {/* Readable at every role; the controls below are gated to the
          roles that can actually change them. */}
      <div className="px-5 pt-4">
        <ReadOnlyBanner role={viewer?.orgRole} capability="manage_integrations" what="the integration settings" />
      </div>

      {(gmailParam === "connected" ||
        gmailParam === "denied" ||
        gmailParam === "error" ||
        gmailError ||
        false) && (
        <div className="shrink-0 space-y-3 border-b border-border px-5 py-4 sm:px-6">
          {gmailError && (
            <div className="card border-review/40 bg-review/5 text-sm text-review">
              {gmailError}
            </div>
          )}
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
                {/* The inbox connection comes first: it is the only email step
                    a customer takes, and nothing else in outreach works
                    without it. */}
                <GoogleInboxCard
                  initial={{ ...inbox, available: config.gmail.configured }}
                />
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
