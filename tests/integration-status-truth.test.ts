import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doUnmock("@/lib/integrations/gmail");
  vi.doUnmock("@/lib/domain/sender-identity");
  vi.doUnmock("@/lib/integration-keys");
  vi.doUnmock("@/lib/integration-settings");
  vi.doUnmock("@/lib/integrations/http");
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/data");
  vi.doUnmock("@/lib/tenant");
});

describe("platform system-mail readiness", () => {
  it("does not call a stored but revoked Google grant enabled", async () => {
    const isConnected = vi.fn(async () => true);
    const canAuthenticate = vi.fn(async () => false);
    vi.doMock("@/lib/integrations/gmail", () => ({
      gmail: { isConnected, canAuthenticate, send: vi.fn() },
    }));
    vi.doMock("@/lib/domain/sender-identity", () => ({
      resolveOutreachSender: vi.fn(async () => null),
    }));

    const { systemMail } = await import("@/lib/integrations/system-mail");

    await expect(systemMail.configured()).resolves.toBe(true);
    await expect(systemMail.enabled()).resolves.toBe(false);
    await expect(systemMail.deliverable()).resolves.toBe(false);
    expect(isConnected).toHaveBeenCalledOnce();
    expect(canAuthenticate).toHaveBeenCalledTimes(2);
  });

  it("keeps an unreadable mailbox status distinct from a disconnected mailbox", async () => {
    vi.doMock("@/lib/integrations/gmail", () => ({
      gmail: {
        isConnected: vi.fn(async () => true),
        canAuthenticate: vi.fn(async () => {
          throw new Error("connection row unavailable");
        }),
        send: vi.fn(),
      },
    }));
    vi.doMock("@/lib/domain/sender-identity", () => ({
      resolveOutreachSender: vi.fn(async () => null),
    }));

    const { systemMail } = await import("@/lib/integrations/system-mail");
    await expect(systemMail.enabled()).rejects.toThrow("connection row unavailable");
  });
});

describe("Ahrefs settings and provider outcomes", () => {
  async function loadAhrefs(input: {
    key?: string;
    target?: string;
    provider?: () => Promise<unknown>;
  }) {
    const orgApiKey = vi.fn(async (key: string) => {
      if (key === "AHREFS_API_KEY") return input.key ?? "saved-admin-key";
      if (key === "AHREFS_TARGET") return input.target ?? "https://www.Example.com/path";
      return "";
    });
    const fetchJson = vi.fn(input.provider ?? (async () => ({ refdomains: [] })));
    const recordIntegrationUse = vi.fn(async () => undefined);
    vi.doMock("@/lib/integration-keys", () => ({ orgApiKey }));
    vi.doMock("@/lib/integration-settings", () => ({ recordIntegrationUse }));
    vi.doMock("@/lib/integrations/http", () => ({
      fetchJson,
      withRetry: async (fn: () => Promise<unknown>) => fn(),
    }));
    const ahrefsModule = await import("@/lib/integrations/ahrefs");
    return { ...ahrefsModule, orgApiKey, fetchJson, recordIntegrationUse };
  }

  it("uses the platform account values saved by the admin UI", async () => {
    const { ahrefs, orgApiKey } = await loadAhrefs({});

    await expect(ahrefs.configuration("platform-org")).resolves.toEqual({
      enabled: true,
      target: "example.com",
    });
    expect(orgApiKey).toHaveBeenCalledWith("AHREFS_API_KEY", "platform-org");
    expect(orgApiKey).toHaveBeenCalledWith("AHREFS_TARGET", "platform-org");
  });

  it("keeps an absent key distinct from a successful empty response", async () => {
    const { ahrefs, fetchJson } = await loadAhrefs({ key: "" });

    await expect(ahrefs.referringDomains("example.com")).resolves.toEqual({
      disabled: true,
      items: [],
    });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("throws and records a provider refusal instead of returning success with no rows", async () => {
    const { ahrefs, recordIntegrationUse } = await loadAhrefs({
      provider: async () => {
        throw new Error("quota exhausted");
      },
    });

    await expect(ahrefs.referringDomains("example.com")).rejects.toThrow(
      "No empty result was recorded as a successful scan"
    );
    expect(recordIntegrationUse).toHaveBeenCalledWith(
      "AHREFS_API_KEY",
      expect.objectContaining({
        ok: false,
        error: expect.stringContaining("quota exhausted"),
      })
    );
  });
});

describe("truthful failure states around workflow status", () => {
  it("does not convert an unreadable abort impact into zero affected records", async () => {
    const queryOne = vi
      .fn()
      .mockResolvedValueOnce({
        title: "Roof repair",
        solicitation_number: "ABC-123",
        deadline: null,
        stage: "outreach",
      })
      .mockRejectedValueOnce(new Error("count failed"));
    vi.doMock("@/lib/db", () => ({ queryOne }));
    vi.doMock("@/lib/tenant", () => ({
      resolveTenantOrgId: vi.fn(async () => "org-1"),
    }));

    const { pursuitImpact } = await import("@/lib/pursuit-impact");
    await expect(pursuitImpact("opp-1")).rejects.toThrow("count failed");
    expect(queryOne.mock.calls[0]?.[0]).toContain("org_id = $2");
    expect(queryOne.mock.calls[0]?.[1]).toEqual(["opp-1", "org-1"]);
  });

  it("does not convert a missing automation aggregate row into zero impact", async () => {
    vi.doMock("@/lib/db", () => ({ queryOne: vi.fn(async () => null) }));
    vi.doMock("@/lib/data", () => ({ currentOrg: vi.fn(async () => "org-1") }));
    const { ruleFacts } = await import("@/lib/rule-preview");
    const rules = {
      min_lead_days: 5,
      lead_action: "review" as const,
      approaching_days: 7,
      urgent_days: 2,
      retention_days: 90,
      calls_enabled: true,
      auto_dismiss_review: false,
      auto_dismiss_warn_hours: 24,
      followup_hours: 48,
      followup_max: 1,
      outreach_batch_limit: 10,
      call_hours_start: 9,
      call_hours_end: 17,
      call_max_attempts: 3,
      final_nudge_enabled: false,
    };

    await expect(ruleFacts(rules, rules)).rejects.toThrow(
      "Automation-rule impact counts could not be read"
    );
  });

  it("keeps Guide Me and rule-save failures explicit and fail closed", () => {
    const guide = readFileSync("lib/guide/load.ts", "utf8");
    const guideRoute = readFileSync("app/api/guide/route.ts", "utf8");
    const rulesRoute = readFileSync("app/api/automation/rules/route.ts", "utf8");
    const rulesForm = readFileSync("components/automation-rules-form.tsx", "utf8");

    expect(guide).not.toContain("getAutomationState().catch");
    expect(guide).not.toContain("areCallsEnabled().catch");
    expect(guide).not.toContain("actionCenter().catch");
    expect(guide).not.toContain("queueCounts().catch");
    expect(guideRoute).toContain("No zero counts or completion claims are being shown");
    expect(rulesRoute).not.toContain("ruleFacts(current, normalized).catch");
    expect(rulesRoute).toContain("confirm_impacts");
    expect(rulesRoute).toContain("Nothing was saved");
    expect(rulesForm).toContain("dirty && impacts === null");
    expect(rulesForm).toContain("void save(true)");
  });
});
