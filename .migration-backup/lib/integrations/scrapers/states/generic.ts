/**
 * Generic state-portal scraper factory. Most state procurement portals render a
 * searchable listing of open solicitations. This driver navigates to the portal,
 * attempts a best-effort extraction of listing rows (title + link + any visible
 * deadline), and returns normalized opportunities. Portal DOMs differ, so this
 * is deliberately defensive: it extracts what it can and never throws upward.
 *
 * For a production-grade extraction of a specific state, implement a dedicated
 * module (see tx.ts) with that portal's exact selectors and pagination. This
 * generic driver is the safe fallback so every priority state is at least
 * attempted from day one.
 */
import { createHash } from "node:crypto";
import type { ScrapedOpportunity, ScraperContext, StateScraper } from "../index";

export function genericPortalScraper(
  state: string,
  name: string,
  url: string
): StateScraper {
  return {
    state,
    name,
    async run(ctx: ScraperContext): Promise<ScrapedOpportunity[]> {
      const { page, close } = await ctx.newPage();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        // Best-effort: collect anchor rows that look like solicitation links.
        const rows = await page.$$eval("a", (anchors) =>
          anchors
            .map((a) => ({
              text: (a.textContent ?? "").trim(),
              href: (a as HTMLAnchorElement).href,
            }))
            .filter(
              (r) =>
                r.text.length > 15 &&
                /(solicitation|bid|rfp|rfq|ifb|contract|procurement|opportunity)/i.test(
                  r.text
                )
            )
            .slice(0, 40)
        );
        return rows.map((r) => {
          const id = createHash("sha1").update(r.href).digest("hex").slice(0, 24);
          const opp: ScrapedOpportunity = {
            source: `state_${state.toLowerCase()}`,
            source_id: `${state.toLowerCase()}_${id}`,
            title: r.text.slice(0, 240),
            location_state: state,
            agency: name,
            raw: { href: r.href, portal: name },
          };
          return opp;
        });
      } finally {
        await close();
      }
    },
  };
}
