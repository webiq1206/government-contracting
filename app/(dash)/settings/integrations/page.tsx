import { integrationStatus } from "@/lib/config";
import { PageHeader } from "@/components/badges";
import { IntegrationManager } from "@/components/integration-manager";
import { hydrateIntegrationEnv, settingSources } from "@/lib/integration-settings";
import { INTEGRATION_DEFS } from "@/lib/integration-defs";
import { gmail } from "@/lib/integrations/gmail";

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

  const initial = INTEGRATION_DEFS.map((def) => {
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

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Integrations"
        subtitle="Connect the services that power the automation. Paste a key, press Test to verify it live, then Save. Everything is managed right here."
      />

      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-5">
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

        <IntegrationManager initial={initial} />

        <div className="card flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-900">Job queue backend</p>
            <p className="mt-0.5 text-xs text-slate-600">
              {status.queue === "bullmq"
                ? "BullMQ (Redis-backed). REDIS_URL is set."
                : "pg-boss (Postgres-backed). Set REDIS_URL in the environment to switch to BullMQ."}
            </p>
          </div>
          <span className="badge bg-accent/10 font-mono text-accent">{status.queue}</span>
        </div>

        <p className="pb-2 text-xs text-slate-500">
          Values saved here are encrypted before they reach the database, shown
          only as a masked preview, and take effect immediately (the background
          worker refreshes within 5 minutes). Environment variables still work
          as a fallback; a value saved on this page takes priority over its
          environment variable.
        </p>
      </div>
    </div>
  );
}
