/* Measures what the user sees while a queue is loading. Read-only navigation. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const BASE = "http://127.0.0.1:3100";
const EXE = "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";
const [l1] = readFileSync("/home/runner/audit-accounts.txt", "utf8").trim().split("\n");
const [E1, P1] = l1.split(" ");

const browser = await chromium.launch({ executablePath: EXE });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: E1, password: P1 } });

const targets = [
  ["Opportunities", "/pipeline"],
  ["Review", "/review"],
  ["Subs", "/subs"],
  ["Workbench", "/workbench"],
];

for (const [linkName, path] of targets) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/today`, { waitUntil: "networkidle", timeout: 120000 });
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 120000 }); // warm dev compile
  await page.goto(`${BASE}/today`, { waitUntil: "networkidle", timeout: 120000 });
  // slow every subsequent request down so the in-between state is observable
  await page.route("**/*", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  const samples = [];
  const link = page.getByRole("link", { name: linkName, exact: false }).first();
  await link.click({ noWaitAfter: true });
  for (let t = 150; t <= 2400; t += 300) {
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => {
      const h1 = document.querySelector("main h1, h1");
      const skeleton = document.querySelectorAll(
        '[class*="skeleton"], [class*="animate-pulse"], [role="progressbar"], [aria-busy="true"]'
      ).length;
      return { h1: h1 ? h1.textContent.trim().slice(0, 40) : "(none)", skeleton };
    });
    samples.push(`${String(t).padStart(4)}ms url=${new URL(page.url()).pathname} h1="${state.h1}" skeletonNodes=${state.skeleton}`);
  }
  console.log(`\n===== click "${linkName}" -> ${path} =====\n` + samples.join("\n"));
  await page.close();
}
await browser.close();
