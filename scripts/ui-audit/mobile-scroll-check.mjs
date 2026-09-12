import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const device = process.env.AUDIT_DEVICE || "mobile";
if (device === "desktop") process.exit(0);

const base = "http://127.0.0.1:3100";
const ids = JSON.parse(readFileSync("/tmp/ui-fixtures.json", "utf8"));
const size = device === "tablet" ? { width: 820, height: 1180 } : { width: 390, height: 844 };
const browser = await chromium.launch();

try {
  const context = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true });
  await context.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(base + "/login");
  await page.getByLabel("Email", { exact: true }).fill("ui-owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("DisposableUiAudit123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/today", { timeout: 60000, waitUntil: "networkidle" });

  async function assertDocumentScrolls(label) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const before = await page.evaluate(() => ({ y: window.scrollY, h: document.documentElement.scrollHeight, v: innerHeight }));
    assert(before.h > before.v + 100, `${label}: fixture must be taller than the viewport`);
    await page.evaluate(() => window.scrollBy(0, Math.min(600, document.documentElement.scrollHeight - innerHeight)));
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => window.scrollY);
    assert(after > before.y + 20, `${label}: document did not scroll`);
  }

  await assertDocumentScrolls("Today initial");

  const menuButton = page.getByRole("button", { name: "Open menu", exact: true });
  await menuButton.click();
  await page.getByRole("navigation", { name: "Main", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("main")?.inert);
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), "hidden", "Menu close stranded body overflow lock");
  await assertDocumentScrolls("Today after menu close");

  await page.goto(`${base}/admin/accounts?peek=${ids.org}`, { waitUntil: "networkidle" });
  const drawer = page.getByRole("dialog", { name: "Record details", exact: true });
  await drawer.waitFor();
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "hidden" });
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), "hidden", "Drawer close stranded body overflow lock");

  await page.goto(base + "/today", { waitUntil: "networkidle" });
  await assertDocumentScrolls("Today after drawer close");
  console.log(JSON.stringify({ device, status: "document scrolling and overlay recovery verified" }));
  await context.close();
} finally {
  await browser.close();
}
