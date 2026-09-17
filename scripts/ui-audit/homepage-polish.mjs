import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function auditHomepagePolish(page, { device, width, height, out }) {
  if (device === 'desktop') {
    for (const viewport of [{width:1366,height:768},{width:1918,height:1077},{width:1440,height:1000}]) {
      await page.setViewportSize(viewport);
      await page.evaluate(()=>scrollTo(0,0));
      const ribbon = await page.locator('.bco-industry-ribbon').boundingBox();
      assert(ribbon.y>=viewport.height-1,'Industry section begins below the desktop fold');
      const cta=await page.locator('.bco-hero-centered .bco-button').boundingBox();
      assert(cta.y+cta.height<viewport.height,'Desktop trial CTA stays above fold');
      await page.screenshot({path:join(out,`${device}-hero-scene-${viewport.width}.png`)});
    }
    await page.setViewportSize({width,height});
  }
  if (device === 'mobile') {
    for (const mobileWidth of [320, 390, 430]) {
      await page.setViewportSize({ width: mobileWidth, height: 844 });
      await page.evaluate(() => scrollTo(0, 0));
      const heading = await page.locator('.bco-hero-centered h1').evaluate(el => {
        const box = el.getBoundingClientRect(), style = getComputedStyle(el);
        return { left: box.left, right: box.right, size: parseFloat(style.fontSize), align: style.textAlign, overflow: el.scrollWidth > el.clientWidth + 1 };
      });
      assert(heading.left >= 24 && heading.right <= mobileWidth - 24, 'Mobile heading has breathing room');
      assert(heading.size <= 38 && heading.align === 'left' && !heading.overflow, 'Mobile heading is readable and unclipped');
      const cta = await page.locator('.bco-hero-centered .bco-button').boundingBox();
      assert(cta && cta.y + cta.height < 844, 'Trial remains visible in the first screen');
      await page.screenshot({ path: join(out, `${device}-hero-scene-${mobileWidth}.png`), animations: 'disabled' });
    }
    await page.setViewportSize({ width, height });
    await page.locator('.bco-final-cta .bco-button').first().scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('.bco-nav [data-hero-hidden]')?.dataset.heroHidden === 'false');
    assert(!(await page.locator('.bco-nav [data-hero-hidden]').isVisible()), 'Do not duplicate a visible trial action');
  }
  const chapter = page.locator('[data-chapter="discover"]');
  await chapter.scrollIntoViewIfNeeded();
  const stage = chapter.locator('.bco-chapter-stage');
  const before = await stage.boundingBox();
  await chapter.getByRole('tab').nth(1).click();
  const after = await stage.boundingBox();
  assert(Math.abs(before.height - after.height) < 2, 'Switching tours preserves the stage height');
  assert.equal(await chapter.getByRole('tabpanel').count(), 1, 'Only the active panel is accessible');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await chapter.getByRole('tab').nth(0).click();
  assert.equal(await chapter.locator('[role=tabpanel]:not([hidden])').evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => scrollTo(0, 0));
}
