import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("runtime failures stay distinguishable from empty or healthy states", () => {
  it("propagates account and invoice read failures to pages that explain them", () => {
    const account = read("lib/account.ts");
    const invoices = read("lib/billing/invoices.ts");
    const accountPage = read("app/(account)/settings/account/page.tsx");
    const billingPage = read("app/(account)/settings/billing/page.tsx");

    expect(account).not.toMatch(/accountDetails[\s\S]*?\.catch\(\(\) => null\)/);
    expect(account).not.toMatch(/accountSessions[\s\S]*?\.catch\(\(\) => \[\]/);
    expect(invoices).not.toContain(").catch(() => []);");
    expect(accountPage).toContain("Signed-in devices are unavailable");
    expect(accountPage).toContain("No device action is available until this list is verified");
    expect(billingPage).toContain("Invoice history could not be loaded");
  });

  it("makes a failed invoice ledger write retry the Stripe event", () => {
    const invoices = read("lib/billing/invoices.ts");
    const webhook = read("app/api/billing/webhook/route.ts");

    expect(invoices).not.toContain("could not record an invoice");
    expect(webhook).toContain("await completeEvent(event.id)");
    expect(webhook).toContain("await markEventFailed(event.id");
    expect(webhook).toContain("{ error: \"handler failed\" }");
    const orgLookup = webhook.slice(
      webhook.indexOf("async function orgIdForCustomer"),
      webhook.indexOf("const asId")
    );
    expect(orgLookup).not.toContain("catch");
    expect(webhook).not.toContain(").catch(() => null))?.id");
  });

  it("does not turn custom KPI, agent status, or Action Center faults into no data", () => {
    const data = read("lib/data.ts");
    const reporting = read("lib/reporting.ts");

    const custom = data.slice(data.indexOf("export async function customKpis"), data.indexOf("export async function agentLogs"));
    const statuses = data.slice(data.indexOf("export async function agentStatuses"), data.indexOf("export async function jobRunsSummary"));
    const action = data.slice(data.indexOf("export async function actionCenter"), data.indexOf("export interface EngineStatus"));

    expect(custom).not.toContain("catch");
    expect(statuses).not.toContain("catch");
    expect(action).not.toContain(".catch(() => [])");
    expect(action).not.toContain(".catch(() => null)");
    expect(action).toContain("The Action Center totals query returned no result");
    expect(reporting).toContain("const raw = await computeCustomKpi(def.id, params);");
  });

  it("keeps the worker unready when schema migration or boot recovery fails", () => {
    const worker = read("worker/index.ts");

    expect(worker).not.toContain("continuing with the existing schema");
    expect(worker).toContain(
      'await step("schema-check", STEP_TIMEOUTS.migrations, () => verifyMigrationsCurrent())'
    );
    expect(worker).toContain(
      'await step("recover-interrupted-runs", STEP_TIMEOUTS.recovery'
    );
  });

  it("returns an explicit warning when recovery incidents cannot synchronize", () => {
    const route = read("app/api/automation/recovery/route.ts");

    expect(route).toContain("incident synchronization failed");
    expect(route).toContain("The list may be incomplete");
    expect(route).toContain("{ incidents: withHistory, warning }");
  });
});
