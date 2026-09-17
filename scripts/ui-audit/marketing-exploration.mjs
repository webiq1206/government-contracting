import assert from 'node:assert/strict';
import { join } from 'node:path';

/** Run on disposable audit data only. No signup, sends, or external actions. */
export async function auditMarketingExploration(p, { device, width, height, out }) {
  const explorer = p.locator('#interactive-workflow');
  if (!(await explorer.evaluate(el => el.open))) await explorer.locator('summary').click();
  const workflow = p.locator('.bco-workflow-demo');
  const tabs = workflow.getByRole('tab');
  await tabs.nth(3).click();
  const source = workflow.getByRole('button', { name: 'Open sample source', exact: true });
  await source.click();
  const dialog = p.getByRole('dialog', { name: 'From the source to the next step' });
  await dialog.waitFor();
  assert.equal(await p.evaluate(() => document.body.style.overflow), 'hidden');
  await p.keyboard.press('Tab');
  assert(await dialog.evaluate(el => el.contains(document.activeElement)), 'Modal keeps keyboard focus inside');
  await p.screenshot({ path: join(out, `${device}-source-lightbox.png`) });
  await p.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert(await source.evaluate(el => el === document.activeElement), 'Source trigger regains focus');
  assert.notEqual(await p.evaluate(() => document.body.style.overflow), 'hidden');

  if (width <= 950) {
    const sizes = device === 'mobile' ? [{ width, height }, { width: 320, height: 640 }, { width: 844, height: 390 }] : [{ width, height }];
    for (const size of sizes) {
      await p.setViewportSize(size);
      await tabs.nth(0).click();
      await workflow.locator('.bco-preview').evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + scrollY + 180));
      await p.waitForFunction(() => {
        const bar = document.querySelector('.bco-demo-tabs');
        return Math.abs(bar.getBoundingClientRect().top - parseFloat(getComputedStyle(bar).top)) < 3;
      });
      assert(await p.locator('.bco-nav [data-hero-hidden="true"]').isVisible(), 'Trial CTA remains available after hero');
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, 'No horizontal page overflow');
      await p.screenshot({ path: join(out, `${device}-${size.width}-sticky-steps.png`) });
      await tabs.nth(2).click();
      await p.waitForFunction(() => {
        const bar = document.querySelector('.bco-demo-tabs').getBoundingClientRect();
        const panel = document.querySelector('.bco-demo-panel').getBoundingClientRect();
        return panel.top >= bar.bottom && panel.top < bar.bottom + 40;
      });
      assert.equal(await tabs.nth(2).getAttribute('aria-selected'), 'true');
      await workflow.getByRole('button', { name: 'Previous step', exact: true }).click();
      assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
      await workflow.evaluate(el => window.scrollTo(0, el.getBoundingClientRect().bottom + scrollY - 70));
      assert(await workflow.evaluate(el => el.querySelector('.bco-demo-tabs').getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + 1), 'Pinned tabs release at section boundary');
    }
    await p.setViewportSize({ width, height });
  }
  await p.locator('#workflow').screenshot({ path: join(out, `${device}-first-week.png`) });
  await p.locator('.bco-industry-ribbon').scrollIntoViewIfNeeded();
  assert.equal(await p.getByRole('button', { name: /Pause industry ribbon|Play industry ribbon/ }).count(), 0);
  for (const selector of ['.bco-ribbon-track', '.bco-industry-loop']) {
    const track = p.locator(selector);
    await track.evaluate(el => el.parentElement.scrollIntoView({block:'center'}));
    assert.equal(await track.evaluate(el=>getComputedStyle(el).animationTimingFunction), 'linear');
    const before = await track.evaluate(el=>getComputedStyle(el).transform);
    await p.waitForFunction(({selector,before})=>getComputedStyle(document.querySelector(selector)).transform!==before,{selector,before});
    assert(await track.evaluate(el=>Math.abs(el.children[0].getBoundingClientRect().width-el.children[1].getBoundingClientRect().width)<1),'Loop copies have equal widths');
    await p.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await track.evaluate(el=>getComputedStyle(el).animationName),'none');
    assert.equal(await track.locator('[aria-hidden="true"]').isVisible(),false);
    await p.emulateMedia({reducedMotion:'no-preference'});
  }
  await p.evaluate(() => window.scrollTo(0, 0));
}
