import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { parseHTML } from "linkedom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { ActivityLedger, type ActivityData } from "@/components/activity-ledger";
import { ReceiptStatusCard } from "@/components/receipt-status-card";
import { StoredTime } from "@/components/stored-time";
import { storedTimestamp } from "@/lib/domain/stored-timestamp";
import { syncLine } from "@/lib/domain/connected-services";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// The production failure was PostgreSQL timestamptz text rendered with the
// browser's implicit timezone. Keep the payload synthetic and its exact form.
function activityFixture(at = "2026-10-10 19:15:07.014382+00"): ActivityData {
  return {
    viewScope: "synthetic-org:viewer", page: 1, pageSize: 50, actors: ["scoring-engine"],
    summary: { total: 1, attention: 0, sent: 0, received: 0, bids: 0 },
    rows: [{ id: "synthetic-1", occurred_at: at, category: "automation", title: "Synthetic scoring event",
      status: "ok", actor: "scoring-engine", source_table: "agent_logs", source_id: "synthetic-log",
      operation: "INSERT", historical: false, opportunity_id: null, opportunity: null,
      subcontractor_id: null, company: null, detail: {} }],
  };
}

describe("stored event timestamps", () => {
  it.each(["UTC", "America/Denver", "Pacific/Auckland"])("shows the ledger's actual UTC instant in %s", (zone) => {
    vi.stubEnv("TZ", zone);
    const html = renderToStaticMarkup(<ActivityLedger initialData={activityFixture()} />);
    const { document } = parseHTML(html);
    expect(document.querySelector("time")?.textContent).toBe("Oct 10, 2026, 7:15:07 PM UTC");
    // ISO normalization preserves the instant at JavaScript millisecond precision.
    expect(document.querySelector("time")?.getAttribute("dateTime")).toBe("2026-10-10T19:15:07.014Z");
  });

  it.each(["2026-10-10 19:15:07", "invalid"])("does not assign a timezone to %s", (at) => {
    const { document } = parseHTML(renderToStaticMarkup(<ActivityLedger initialData={activityFixture(at)} />));
    expect(document.querySelector("time")?.textContent).toBe("Time unavailable");
    expect(document.querySelector("time")?.hasAttribute("dateTime")).toBe(false);
  });

  it("does not append the recorded input timezone to a browser-local receipt time", () => {
    vi.stubEnv("TZ", "Pacific/Auckland");
    const html = renderToStaticMarkup(<ReceiptStatusCard state="receipt_confirmed"
      sentAt={new Date("2026-03-01T14:02:00Z")} timezone="America/Chicago"
      method="Synthetic portal" destination="example.test" confirmationNumber={null} proofName={null} />);
    const { document } = parseHTML(html);
    expect(document.querySelector("time")?.textContent).toBe("Mar 1, 2026, 2:02 PM UTC");
    expect(html).toContain("Recorded timezone");
    expect(html).toContain("America/Chicago");
    expect(html).not.toContain("(America/Chicago)");
  });

  it("preserves offset instants through a daylight-saving fold and year rollover", () => {
    expect(storedTimestamp("2026-11-01T01:30:07.123-06:00", { seconds: true })).toEqual({
      label: "Nov 1, 2026, 7:30:07 AM UTC", dateTime: "2026-11-01T07:30:07.123Z",
    });
    expect(storedTimestamp("2026-11-01T01:30:07.123-07:00", { seconds: true })).toEqual({
      label: "Nov 1, 2026, 8:30:07 AM UTC", dateTime: "2026-11-01T08:30:07.123Z",
    });
    expect(storedTimestamp("2026-12-31T23:59:59-06:00", { seconds: true }).label)
      .toBe("Jan 1, 2027, 5:59:59 AM UTC");
  });

  it("uses the same UTC formatter for connection histories and reusable time elements", () => {
    const at = "2026-10-10 19:15:07.014382+00";
    const { document } = parseHTML(renderToStaticMarkup(<StoredTime value={at} />));
    expect(document.querySelector("time")?.textContent).toBe("Oct 10, 2026, 7:15 PM UTC");
    expect(syncLine({ status: "connected", last_synced_at: at, last_error: null }))
      .toBe("Connected. Last synced Oct 10, 2026, 7:15 PM UTC.");
    expect(syncLine({ status: "connected", last_synced_at: "not a date", last_error: null }))
      .toContain("Time unavailable");
  });

  it("hydrates the actual ledger from a UTC server into a Denver browser without changing its time", async () => {
    vi.stubEnv("TZ", "UTC");
    const data = activityFixture();
    const html = renderToString(<ActivityLedger initialData={data} />);
    // A real HTML parser folds attribute names; linkedom preserves their case.
    const { window } = parseHTML(`<html><body><main>${html}</main></body></html>`);
    for (const element of window.document.querySelectorAll("*")) {
      for (const attribute of [...element.attributes]) {
        if (attribute.name !== attribute.name.toLowerCase()) {
          element.removeAttribute(attribute.name);
          element.setAttribute(attribute.name.toLowerCase(), attribute.value);
        }
      }
    }
    const getAttribute = window.HTMLElement.prototype.getAttribute;
    vi.spyOn(window.HTMLElement.prototype, "getAttribute").mockImplementation(function(this: HTMLElement, name: string) {
      return getAttribute.call(this, name.toLowerCase());
    });
    const hasAttribute = window.HTMLElement.prototype.hasAttribute;
    vi.spyOn(window.HTMLElement.prototype, "hasAttribute").mockImplementation(function(this: HTMLElement, name: string) {
      return hasAttribute.call(this, name.toLowerCase());
    });
    vi.stubEnv("TZ", "America/Denver");
    vi.stubGlobal("window", window);
    vi.stubGlobal("document", window.document);
    vi.stubGlobal("localStorage", { getItem: () => null });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const fetch = vi.fn(() => { throw new Error("No network is allowed in this hydration regression"); });
    vi.stubGlobal("fetch", fetch);
    const errors: string[] = [];
    const warnings = vi.spyOn(console, "error").mockImplementation(() => {});
    const { hydrateRoot } = await import("react-dom/client");
    await act(async () => {
      root = hydrateRoot(document.querySelector("main")!, <ActivityLedger initialData={data} />, {
        onRecoverableError: error => errors.push(String(error)),
      });
    });
    expect(errors).toEqual([]);
    expect(warnings).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(document.querySelector("time")?.textContent).toBe("Oct 10, 2026, 7:15:07 PM UTC");
    expect(document.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-10T19:15:07.014Z");
    expect(data.rows[0].occurred_at).toBe("2026-10-10 19:15:07.014382+00");
  });
});
