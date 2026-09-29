import { PUBLIC_ROUTES } from "@/lib/domain/public-routes";
import { publicEventPayload, type PublicEvent } from "@/lib/domain/public-analytics";
import { growthAttribution } from "./growth-attribution";

// Public destination identifier, not a credential. Production does not depend
// on a separately configured Replit build-time secret.
export const GA4_ID = "G-5KK7K8WMRV";
export const GA4_READY = "brostco:ga4-ready";
export const ANALYTICS_CHOICE_KEY = "brostco-analytics-consent-v2";
const titles = new Map(PUBLIC_ROUTES.map((route) => [route.path, route.label]));
titles.set("/billing/success", "Checkout complete");
let consent = false;
let initialized = false;
let lastPage: string | null = null;
type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
    "ga-disable-G-5KK7K8WMRV"?: boolean;
  }
}

export function analyticsAllowed(): boolean {
  return typeof window !== "undefined"
    && ["brostco.com", "www.brostco.com"].includes(window.location.hostname)
    && navigator.doNotTrack !== "1"
    && !(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl;
}

/** Track the public website and checkout confirmation, never private records. */
export function ga4Page(pathname: string) {
  const path = pathname.split(/[?#]/)[0].replace(/\/$/, "") || "/";
  const title = titles.get(path);
  return title ? { page_location: `https://brostco.com${path}`, page_path: path, page_title: `${title} | BrostCo` } : null;
}

export function safeReferrer(referrer: string): string {
  try {
    const url = new URL(referrer);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (["brostco.com", "www.brostco.com"].includes(url.hostname)) return ga4Page(url.pathname)?.page_location || "https://brostco.com/";
    return url.origin + "/";
  } catch { return ""; }
}

export function setGa4Consent(granted: boolean) {
  consent = granted && analyticsAllowed();
  if (typeof window === "undefined") return;
  window["ga-disable-G-5KK7K8WMRV"] = !consent;
  if (!consent) {
    lastPage = null;
    window.gtag?.("consent", "update", { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
  }
}

export function syncGa4Page(pathname: string) {
  if (!consent || !analyticsAllowed()) return;
  const page = ga4Page(pathname);
  window["ga-disable-G-5KK7K8WMRV"] = !page;
  if (!page) { lastPage = null; return; }
  if (!initialized) {
    window.dataLayer ??= [];
    window.gtag ??= function () { window.dataLayer!.push(arguments); };
    window.gtag("consent", "default", { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
    window.gtag("js", new Date());
    window.gtag("consent", "update", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
    window.gtag("config", GA4_ID, {
      ...page, page_referrer: safeReferrer(document.referrer),
      send_page_view: false, allow_google_signals: false,
      ignore_referrer: page.page_path === "/billing/success",
      allow_ad_personalization_signals: false, cookie_flags: "SameSite=Lax;Secure",
    });
    const script = document.createElement("script");
    script.id = "brostco-ga4";
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`;
    document.head.appendChild(script);
    initialized = true;
  }
  if (lastPage !== page.page_path) {
    const referrer = lastPage ? `https://brostco.com${lastPage}` : safeReferrer(document.referrer);
    const campaign = growthAttribution();
    window.gtag!("set", { ...page, page_referrer: referrer });
    window.gtag!("event", "page_view", {
      ...page, page_referrer: referrer, send_to: GA4_ID,
      ...(campaign.source ? { campaign_source: campaign.source, campaign_medium: campaign.source === "newsletter" ? "email" : campaign.source === "partner" ? "referral" : "organic" } : {}),
      ...(campaign.campaign ? { campaign_name: campaign.campaign } : {}),
      ...(campaign.content ? { campaign_content: campaign.content } : {}),
    });
    lastPage = page.page_path;
  }
  window.dispatchEvent(new Event(GA4_READY));
}

function send(event: string, details: Record<string, unknown> = {}): boolean {
  if (!consent || !initialized || !analyticsAllowed() || window["ga-disable-G-5KK7K8WMRV"]) return false;
  const page = ga4Page(window.location.pathname);
  if (!page) return false;
  window.gtag?.("event", event, { ...details, ...page, send_to: GA4_ID });
  return true;
}

export function ga4MarketingEvent(event: PublicEvent, details: { target?: string; location?: string }) {
  if (event === "marketing_page_view" || typeof window === "undefined") return;
  const safe = publicEventPayload({ event, path: window.location.pathname, ...details });
  if (safe) send(event, safe.meta);
}

/** Called only after the signup API confirms the account and trial exist. */
export async function ga4Signup(plan: "founding" | "standard") {
  send("trial_started", { plan, trial_days: 7 });
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 800);
    const sent = send("sign_up", { method: "email", plan, event_timeout: 750, event_callback: () => { clearTimeout(timeout); resolve(); } });
    if (!sent) { clearTimeout(timeout); resolve(); }
  });
}

export type Ga4Purchase = { transaction_id: string; value: number; currency: string; plan: "founding" | "standard"; interval: "month" | "year" };
const sentPurchases = new Set<string>();
export function ga4Purchase(purchase: Ga4Purchase): boolean {
  const key = `brostco-ga4-purchase:${purchase.transaction_id}`;
  if (sentPurchases.has(key)) return true;
  try { if (sessionStorage.getItem(key)) return true; } catch { /* In-memory deduplication still works. */ }
  const sent = send("purchase", {
    transaction_id: purchase.transaction_id, value: purchase.value, currency: purchase.currency,
    items: [{ item_id: `${purchase.plan}-${purchase.interval}`, item_name: `BrostCo ${purchase.plan}`, item_category: "subscription", item_variant: purchase.interval, price: purchase.value, quantity: 1 }],
  });
  if (sent) {
    sentPurchases.add(key);
    try { sessionStorage.setItem(key, "1"); } catch { /* Optional storage. */ }
  }
  return sent;
}
