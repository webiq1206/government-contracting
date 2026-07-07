/**
 * State / local procurement scrapers. Most state contractor and procurement
 * portals have no public API, so we scrape them with Playwright (headless
 * Chromium). Each state is a SEPARATE module, a broken scraper never blocks
 * the others (each is wrapped in its own try/catch here).
 *
 * Scrapers are OFF by default (ENABLE_SCRAPERS=false) because they need browser
 * dependencies. On Replit, replit.nix provides Chromium and points Playwright at
 * it. Turn on with ENABLE_SCRAPERS=true once the browser is available.
 *
 * Priority states by federal contract award volume (spec): CA, TX, FL, NY, PA,
 * OH, GA, NC, VA, WA.
 */
import { config } from "../../config";
import { logAgent } from "../../logger";

export interface ScrapedOpportunity {
  source: string; // e.g. "state_tx"
  source_id: string; // stable unique id (portal id or hashed url)
  title: string;
  description?: string;
  naics_code?: string;
  set_aside_type?: string;
  value_estimated?: number;
  deadline?: string;
  location_state?: string;
  agency?: string;
  raw?: Record<string, unknown>;
}

export interface StateScraper {
  state: string; // "TX"
  name: string;
  /** Return normalized opportunities; may filter by the given NAICS codes. */
  run: (ctx: ScraperContext, naics: string[]) => Promise<ScrapedOpportunity[]>;
}

export interface ScraperContext {
  /** Lazily-created Playwright browser page factory. */
  newPage: () => Promise<{
    page: import("playwright").Page;
    close: () => Promise<void>;
  }>;
}

// Registry of state scrapers (priority order). Each module self-registers.
import { texasScraper } from "./states/tx";
import { genericPortalScraper } from "./states/generic";

const SCRAPERS: StateScraper[] = [
  texasScraper,
  // The other priority states share the generic portal driver, parameterized.
  genericPortalScraper("CA", "California eProcure (Cal eProcure)", "https://caleprocure.ca.gov"),
  genericPortalScraper("FL", "Florida Vendor Bid System", "https://vendor.myfloridamarketplace.com"),
  genericPortalScraper("NY", "New York State Contract Reporter", "https://www.nyscr.ny.gov"),
  genericPortalScraper("PA", "PA eMarketplace", "https://www.emarketplace.state.pa.us"),
  genericPortalScraper("OH", "Ohio Procurement (OhioBuys)", "https://ohiobuys.ohio.gov"),
  genericPortalScraper("GA", "Georgia Procurement Registry", "https://ssl.doas.state.ga.us"),
  genericPortalScraper("NC", "NC eVP", "https://evp.nc.gov"),
  genericPortalScraper("VA", "eVA Virginia", "https://mvendor.cgieva.com"),
  genericPortalScraper("WA", "Washington WEBS", "https://pr-webs-vendor.des.wa.gov"),
];

let _browserPromise: Promise<import("playwright").Browser> | null = null;

async function getBrowser(): Promise<import("playwright").Browser | null> {
  try {
    const { chromium } = await import("playwright");
    if (!_browserPromise) {
      const execPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
      _browserPromise = chromium.launch({
        headless: true,
        executablePath: execPath || undefined,
      });
    }
    return _browserPromise;
  } catch (err) {
    console.warn("[scrapers] Playwright not available:", (err as Error).message);
    return null;
  }
}

function makeContext(browser: import("playwright").Browser): ScraperContext {
  return {
    async newPage() {
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (compatible; BrostcoBot/1.0; procurement monitor)",
      });
      const page = await context.newPage();
      return { page, close: () => context.close() };
    },
  };
}

/**
 * Run every enabled state scraper, isolating failures. Returns the union of new
 * opportunities found across all portals.
 */
export async function runEnabledScrapers(
  naics: string[]
): Promise<ScrapedOpportunity[]> {
  if (!config.worker.enableScrapers) return [];
  const browser = await getBrowser();
  if (!browser) {
    await logAgent({
      agent: "opportunity-monitor",
      action: "scrapers",
      level: "warn",
      status: "skipped",
      message: "ENABLE_SCRAPERS=true but Playwright/Chromium unavailable.",
    });
    return [];
  }
  const ctx = makeContext(browser);
  const all: ScrapedOpportunity[] = [];
  for (const scraper of SCRAPERS) {
    try {
      const found = await scraper.run(ctx, naics);
      all.push(...found);
      await logAgent({
        agent: "opportunity-monitor",
        action: `scrape:${scraper.state}`,
        level: "info",
        message: `${scraper.name}: ${found.length} opportunities`,
      });
    } catch (err) {
      // Isolation: one broken scraper does not block the others.
      await logAgent({
        agent: "opportunity-monitor",
        action: `scrape:${scraper.state}`,
        level: "error",
        status: "error",
        message: `${scraper.name} failed: ${(err as Error).message}`,
      });
    }
  }
  return all;
}

export async function closeScraperBrowser(): Promise<void> {
  if (_browserPromise) {
    const b = await _browserPromise;
    await b.close().catch(() => {});
    _browserPromise = null;
  }
}
