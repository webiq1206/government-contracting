import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
let ga: typeof import("@/lib/client/ga4");
const storage = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k) }; };
beforeEach(async () => {
  vi.resetModules();
  const { window } = parseHTML("<html><head></head><body></body></html>");
  Object.defineProperty(window, "location", { configurable: true, value: { hostname: "brostco.com", pathname: "/", search: "?email=private@example.com" } });
  vi.stubGlobal("window", window);
  window.dataLayer = [];
  window.gtag = undefined;
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("sessionStorage", storage());
  ga = await import("@/lib/client/ga4");
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function calls() { return (window.dataLayer || []).map((entry) => Array.from(entry as ArrayLike<unknown>)); }
function events(name: string) { return calls().filter((call) => call[0] === "event" && call[1] === name); }

describe("GA4 collection", () => {
  it("makes no Google request or queued event without consent", () => {
    ga.syncGa4Page("/"); ga.ga4MarketingEvent("cta_click", { target: "/signup" });
    expect(document.querySelector("script")).toBeNull(); expect(calls()).toEqual([]);
  });
  it.each(["doNotTrack", "globalPrivacyControl"])("honors %s", (signal) => {
    vi.stubGlobal("navigator", { [signal]: signal === "doNotTrack" ? "1" : true });
    ga.setGa4Consent(true); ga.syncGa4Page("/");
    expect(document.querySelector("script")).toBeNull();
  });
  it("does not pollute production analytics from preview hosts", () => {
    Object.assign(window.location, { hostname: "localhost" });
    ga.setGa4Consent(true); ga.syncGa4Page("/");
    expect(document.querySelector("script")).toBeNull();
  });
  it("loads once and tracks each route transition once", () => {
    ga.setGa4Consent(true); ga.syncGa4Page("/"); ga.syncGa4Page("/");
    ga.syncGa4Page("/signup"); ga.syncGa4Page("/");
    expect(document.querySelectorAll("#brostco-ga4")).toHaveLength(1);
    expect(events("page_view")).toHaveLength(3);
    expect(JSON.stringify(calls())).not.toContain("private@example.com");
    expect(calls().find((call) => call[0] === "config")?.[2]).toMatchObject({ send_page_view: false });
  });
  it("suppresses collection on private or unknown paths and resumes on public pages", () => {
    ga.setGa4Consent(true); ga.syncGa4Page("/"); ga.syncGa4Page("/opportunity/private-record");
    expect(window["ga-disable-G-5KK7K8WMRV"]).toBe(true);
    ga.ga4MarketingEvent("cta_click", { target: "/signup" });
    expect(events("cta_click")).toHaveLength(0);
    ga.syncGa4Page("/about"); expect(window["ga-disable-G-5KK7K8WMRV"]).toBe(false);
    expect(events("page_view")).toHaveLength(2);
  });
  it("stops custom events immediately on consent withdrawal", () => {
    ga.setGa4Consent(true); ga.syncGa4Page("/"); ga.setGa4Consent(false);
    ga.ga4MarketingEvent("cta_click", { target: "/signup" });
    expect(events("cta_click")).toHaveLength(0);
    expect(window["ga-disable-G-5KK7K8WMRV"]).toBe(true);
  });
  it("allows only public destinations and enumerated event metadata", () => {
    ga.setGa4Consent(true); ga.syncGa4Page("/");
    ga.ga4MarketingEvent("cta_click", { target: "/signup?email=private@example.com", location: "Private Company" });
    const details = events("cta_click")[0][2];
    expect(details).not.toHaveProperty("target"); expect(details).not.toHaveProperty("location");
  });
  it("removes referrer queries and private path identifiers", () => {
    expect(ga.safeReferrer("https://search.example/results?email=private@example.com")).toBe("https://search.example/");
    expect(ga.safeReferrer("https://brostco.com/opportunity/private-id?q=private")).toBe("https://brostco.com/");
    expect(ga.ga4Page("/signup?token=secret#private")).toMatchObject({ page_location: "https://brostco.com/signup" });
  });
  it("deduplicates confirmed purchases without sending the checkout session ID", () => {
    Object.assign(window.location, { pathname: "/billing/success" });
    ga.setGa4Consent(true); ga.syncGa4Page("/billing/success");
    const purchase = { transaction_id: "a".repeat(64), value: 147, currency: "USD", plan: "standard" as const, interval: "month" as const };
    ga.ga4Purchase(purchase); ga.ga4Purchase(purchase);
    expect(events("purchase")).toHaveLength(1);
    expect(events("purchase")[0][2]).toMatchObject({ value: 147, currency: "USD", transaction_id: "a".repeat(64) });
  });
  it("signup delivery has a bounded wait even when the Google script is blocked", async () => {
    vi.useFakeTimers();
    Object.assign(window.location, { pathname: "/signup" });
    ga.setGa4Consent(true); ga.syncGa4Page("/signup");
    const done = vi.fn(); const pending = ga.ga4Signup("standard").then(done);
    await vi.advanceTimersByTimeAsync(800); await pending;
    expect(done).toHaveBeenCalledOnce(); expect(events("sign_up")).toHaveLength(1); expect(events("trial_started")).toHaveLength(1);
  });
});
