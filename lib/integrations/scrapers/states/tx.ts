/**
 * Texas, Electronic State Business Daily (ESBD) scraper. Reference
 * implementation of a dedicated state scraper with real navigation. ESBD lists
 * open solicitations at https://www.txsmartbuy.gov/esbd. This extracts the
 * listing table rows and normalizes them.
 *
 * Note: portal markup changes over time. The extraction is defensive and
 * degrades to zero results rather than throwing, so a markup change never blocks
 * the Opportunity Monitor.
 */
import { createHash } from "node:crypto";
import type { ScrapedOpportunity, ScraperContext, StateScraper } from "../index";

const ESBD_URL = "https://www.txsmartbuy.gov/esbd";

export const texasScraper: StateScraper = {
  state: "TX",
  name: "Texas ESBD (txsmartbuy)",
  async run(ctx: ScraperContext): Promise<ScrapedOpportunity[]> {
    const { page, close } = await ctx.newPage();
    try {
      await page.goto(ESBD_URL, { waitUntil: "networkidle", timeout: 30_000 });
      // ESBD renders results in a table; wait briefly for it, then extract.
      await page
        .waitForSelector("table, .esbd-result, [role=row]", { timeout: 10_000 })
        .catch(() => {});

      const rows = await page.$$eval("a[href*='esbd']", (anchors) =>
        anchors
          .map((a) => {
            const el = a as HTMLAnchorElement;
            const row = el.closest("tr, [role=row], li");
            const text = (row?.textContent ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
            return { href: el.href, title: (el.textContent ?? "").trim(), rowText: text };
          })
          .filter((r) => r.title.length > 8)
          .slice(0, 50)
      );

      return rows.map((r) => {
        const id = createHash("sha1").update(r.href).digest("hex").slice(0, 24);
        // Try to lift a NAICS and a date out of the row text.
        const naics = r.rowText.match(/\b(\d{6})\b/)?.[1];
        const date = r.rowText.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/)?.[1];
        // A string can match the loose date regex yet be invalid (e.g. 13/45/99);
        // new Date(...).toISOString() would throw RangeError and abort the scrape.
        let deadline: string | undefined;
        if (date) {
          const parsed = new Date(date);
          if (!Number.isNaN(parsed.getTime())) deadline = parsed.toISOString();
        }
        const opp: ScrapedOpportunity = {
          source: "state_tx",
          source_id: `tx_${id}`,
          title: r.title.slice(0, 240),
          naics_code: naics,
          deadline,
          location_state: "TX",
          agency: "Texas ESBD",
          raw: { href: r.href, rowText: r.rowText },
        };
        return opp;
      });
    } finally {
      await close();
    }
  },
};
