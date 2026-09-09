import { query } from "../lib/db";
import { billDueUsage, syncUsageAdjustments } from "../lib/api-usage/billing";
import { syncProviderCosts } from "../lib/api-usage/reconciliation";
import { config } from "../lib/config";
/** Separate from procurement pause: reconciliation must continue while spending is stopped. */
export function startUsageBilling(): () => void {
  // Never collect live invoices from the separate development database.
  if (!config.isProd || config.database.isIsolatedDev) return () => {};
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const lease = await query(
        `insert into api_usage_job_leases(name,expires_at) values('billing',now()+interval '1 hour') on conflict(name) do update set expires_at=excluded.expires_at where api_usage_job_leases.expires_at<now() returning name`,
      );
      if (!lease.length) return;
      for (const provider of ["Anthropic", "Twilio"])
        await syncProviderCosts(provider).catch(() => {});
      await syncUsageAdjustments();
      await billDueUsage();
    } catch (e) {
      console.error(
        "[usage-billing] Scheduled run failed:",
        (e as Error).message,
      );
    } finally {
      busy = false;
    }
  }
  const timer = setInterval(() => void tick(), 60 * 60 * 1000);
  void tick();
  return () => clearInterval(timer);
}
