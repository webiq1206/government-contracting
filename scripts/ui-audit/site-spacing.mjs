import assert from "node:assert/strict";
import { join } from "node:path";

// Run on every route, not just the homepage. Check the rendered cascade.
export async function auditSiteSpacing(page, { device, width, out, route }) {
  const marketing = await page.locator('.bco-site').count();
  const inspect = async () => page.evaluate(() => {
    const visible = (selector) => [...document.querySelectorAll(selector)]
      .filter(node => node.getBoundingClientRect().width > 0);
    const sizes = selector => visible(selector).map(node => parseFloat(getComputedStyle(node).fontSize));
    return {
      headings: sizes('.bco-footer-heading'),
      closing: sizes('.bco-final-cta h2'),
      footerLinks: visible('.bco-footer a').map(node => node.getBoundingClientRect().height),
      cards: visible('.bco-card').map(node => parseFloat(getComputedStyle(node).paddingLeft)),
      grids: visible('.bco-card-grid').map(node => parseFloat(getComputedStyle(node).gap)),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  if (!marketing) return;
  const check = async () => {
    const result = await inspect();
    assert.equal(result.headings.length, 3, `${route}: three footer navigation labels`);
    assert(result.headings.every(size => size === 12), `${route}: restrained footer labels`);
    assert(result.closing.every(size => size <= 28), `${route}: restrained closing heading`);
    assert(result.footerLinks.every(size => size >= 44), `${route}: footer touch targets`);
    assert(result.cards.every(size => size >= 24), `${route}: card breathing room`);
    assert(result.grids.every(size => size >= 24), `${route}: card separation`);
    assert(!result.overflow, `${route}: no document overflow`);
  };
  await check();
  if (['/', '/platform', '/pricing-guide', '/security', '/compare'].includes(route)) {
    await page.screenshot({ path: join(out, `${device}-spacing-${route.replaceAll('/', '') || 'home'}.png`), fullPage: true });
  }
  if (device === 'mobile') {
    const viewport = page.viewportSize();
    try {
      await page.setViewportSize({ width: 320, height: viewport.height });
      await check();
      if (route === '/') {
        await page.locator('.bco-footer').screenshot({ path: join(out, `${device}-spacing-footer-320.png`) });
      }
    } finally {
      await page.setViewportSize({ width, height: viewport.height });
      await page.evaluate(() => scrollTo(0, 0));
    }
  }
}
