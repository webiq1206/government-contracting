/*
 * Evidence capture for the isolated audit copy.
 *
 * Logs in through the normal password form (no bypass), then writes PNG files
 * so they can be attached to chat as real downloadable images. Read-only
 * against the app: it navigates and screenshots, it never submits a record.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:3100";
const OUT = "/home/runner/workspace/audit-evidence";
const [l1, l2] = readFileSync("/home/runner/audit-accounts.txt", "utf8").trim().split("\n");
const [E1, P1] = l1.split(" ");
const [E2, P2] = l2.split(" ");

const SIZES = {
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  laptop: { width: 1440, height: 900 },
  desktop: { width: 1920, height: 1080 },
};

async function login(ctx, email, password) {
  // The app's own login endpoint with the account's real password. The session
  // cookie it issues is stored on the browser context, so every later page load
  // is an ordinary authenticated request. Nothing is bypassed.
  const res = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { email, password },
  });
  if (!res.ok()) throw new Error(`login failed for ${email}: ${res.status()}`);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded", timeout: 120000 });
  if (page.url().includes("/login")) throw new Error(`session not accepted for ${email}`);
  return page;
}

async function shot(page, path, name, size) {
  await page.setViewportSize(SIZES[size]);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1500);
  const file = `${OUT}/${name}-${size}.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log("saved", file);
}

const browser = await chromium.launch({ executablePath: "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium" });
await mkdir(OUT, { recursive: true });

const a = await browser.newContext({ viewport: SIZES.laptop });
const p1 = await login(a, E1, P1);
for (const size of ["phone", "tablet", "laptop", "desktop"]) await shot(p1, "/today", "populated-today", size);
for (const size of ["phone", "laptop"]) await shot(p1, "/pipeline", "populated-pipeline", size);
await shot(p1, "/subs", "populated-subs", "laptop");
await shot(p1, "/settings", "partial-settings", "laptop");
await shot(p1, "/opportunity/00000000-0000-4000-8000-0000000000ff", "error-missing-record", "laptop");
for (const size of ["phone", "laptop"]) await shot(p1, "/admin/accounts", "admin-accounts", size);

const b = await browser.newContext({ viewport: SIZES.laptop });
const p2 = await login(b, E2, P2);
await shot(p2, "/today", "empty-today", "laptop");
await shot(p2, "/pipeline", "empty-pipeline", "phone");
await shot(p2, "/admin", "error-admin-forbidden", "laptop");

await browser.close();
console.log("done");
