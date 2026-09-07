import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const BASE = "http://127.0.0.1:3100";
const EXE = "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";
const OPP = "b8d4e7f8-ab28-4919-a320-9bb64e0ef11b";
const [l1] = readFileSync("/home/runner/audit-accounts.txt", "utf8").trim().split("\n");
const [E1, P1] = l1.split(" ");
const browser = await chromium.launch({ executablePath: EXE });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: E1, password: P1 } });
const page = await ctx.newPage();
for (const route of [`/opportunity/${OPP}`, "/pipeline"]) {
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 180000 });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('[role="tab"]')].map((e) => e.textContent.trim().slice(0, 24)),
    tablists: document.querySelectorAll('[role="tablist"]').length,
    buttons: [...document.querySelectorAll("button")].slice(0, 25).map((b) => (b.getAttribute("aria-label") || b.textContent.trim() || "(empty)").slice(0, 30)),
    links: [...document.querySelectorAll("a")].filter((a) => /peek=/.test(a.getAttribute("href") || "")).map((a) => a.getAttribute("href")),
  }));
  console.log(`\n== ${route} ==\ntabs: ${JSON.stringify(info.tabs)}\ntablists: ${info.tablists}\npeek links: ${JSON.stringify(info.links.slice(0, 3))}\nbuttons: ${JSON.stringify(info.buttons)}`);
}
await browser.close();
