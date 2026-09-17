import { webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { auditHomepagePolish } from './homepage-polish.mjs';

const base = 'http://127.0.0.1:3100';
mkdirSync('artifacts/ui-audit/webkit', { recursive: true });
const browser = await webkit.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [], media = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/hero-background.*\.mp4/.test(request.url())) media.push(request.url()); });
  await page.goto(base, { waitUntil: 'networkidle' });
  await auditHomepagePolish(page, { device: 'mobile', width: 390, height: 844, out: 'artifacts/ui-audit/webkit' });
  assert.deepEqual(media, [], 'Mobile WebKit never requests the decorative film');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
  await page.evaluate(() => scrollTo(0, 700));
  assert(await page.evaluate(() => scrollY > 0), 'WebKit document scrolls after menu close');
  assert.deepEqual(errors, []);
  await context.close();

  const fallback = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  const plain = await fallback.newPage();
  await plain.goto(base, { waitUntil: 'networkidle' });
  await plain.screenshot({ path: 'artifacts/ui-audit/webkit/mobile-no-js.png', fullPage: true });
  assert(await plain.locator('h1').isVisible(), 'Heading does not depend on JS');
  assert(await plain.locator('.bco-hero-centered .bco-button').isVisible(), 'Trial does not depend on JS');
  assert(await plain.locator('.bco-chapter-copy h2').first().isVisible(), 'Reveals never hide essential content');
  assert.equal(await plain.locator('.bco-ribbon-track li').count(), 20, 'Manual sector list survives without JS');
  await fallback.close();
  console.log('Mobile WebKit: responsive hero, contextual CTA, stable tours, reduced motion, menu recovery, zero background video requests, and no-JS fallback passed.');
} finally {
  await browser.close();
}
