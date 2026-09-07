import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
const BASE = "http://127.0.0.1:3100";
const EXE = "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";
const OUT = "/home/runner/workspace/audit-evidence";
const OPP = "b8d4e7f8-ab28-4919-a320-9bb64e0ef11b";
const [l1] = readFileSync("/home/runner/audit-accounts.txt", "utf8").trim().split("\n");
const [E1, P1] = l1.split(" ");
const VP = { 390: { width: 390, height: 844 }, 1440: { width: 1440, height: 900 } };
const extra = [];
const browser = await chromium.launch({ executablePath: EXE });
const ctx = await browser.newContext({ viewport: VP[1440] });
await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: E1, password: P1 } });
const page = await ctx.newPage();

// what the opportunity detail page actually says
await page.goto(`${BASE}/opportunity/${OPP}`, { waitUntil: "networkidle", timeout: 180000 });
await page.waitForTimeout(1500);
console.log("OPPORTUNITY DETAIL TEXT >>>");
console.log((await page.evaluate(() => document.querySelector("main")?.innerText || document.body.innerText)).slice(0, 900));
console.log("<<<");

// quick look drawer, reached by the list's own Quick look link href
for (const vw of [1440, 390]) {
  await page.setViewportSize(VP[vw]);
  await page.goto(`${BASE}/pipeline?peek=${OPP}`, { waitUntil: "networkidle", timeout: 180000 });
  await page.waitForTimeout(2500);
  const file = `pipeline-quicklook-drawer-${vw}.png`;
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  extra.push({ file, route: `/pipeline?peek=<opportunity-id>`, role: "owner (populated tenant)", viewport: `${vw}px`, state: "quick-look drawer open" });
  console.log("saved", file);
}

// row action menu
await page.setViewportSize(VP[1440]);
await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle", timeout: 180000 });
await page.getByRole("button", { name: /More actions for/i }).first().click({ timeout: 15000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/pipeline-row-menu-open-1440.png`, fullPage: true });
extra.push({ file: "pipeline-row-menu-open-1440.png", route: "/pipeline", role: "owner (populated tenant)", viewport: "1440px", state: "row action menu open" });
console.log("saved pipeline-row-menu-open-1440.png");
console.log("MENU ITEMS:", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[role="menu"] *, [role="menuitem"]')].map((e) => e.textContent.trim().slice(0, 30)).filter(Boolean).slice(0, 12))));

// sidebar section expanded (open menu) at 1440 - Relationships group
await page.goto(`${BASE}/today`, { waitUntil: "networkidle", timeout: 180000 });
await page.getByRole("button", { name: /Relationships/i }).first().click({ timeout: 10000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/sidebar-section-open-1440.png`, fullPage: true });
extra.push({ file: "sidebar-section-open-1440.png", route: "/today", role: "owner (populated tenant)", viewport: "1440px", state: "sidebar Relationships group expanded" });
console.log("saved sidebar-section-open-1440.png");

await browser.close();
writeFileSync(`${OUT}/manifest-extra.json`, JSON.stringify(extra, null, 2));
