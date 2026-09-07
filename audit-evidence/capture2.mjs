/*
 * Second evidence pass over the isolated audit copy.
 * Inspection only: navigates, clicks tab strips / quick-look / row menus,
 * screenshots. It never submits a form or triggers a send.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:3100";
const EXE = "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";
const OUT = "/home/runner/workspace/audit-evidence";
const SHA = "032238c79320d136c65438357baabd8f42302a50";
const OPP = "b8d4e7f8-ab28-4919-a320-9bb64e0ef11b";
const SUB = "24692bfd-c653-4b56-b5c5-0442932ac8b0";
const ORG1 = "03098722-a301-4865-b0f9-7727cf3dc931";

const [l1, l2] = readFileSync("/home/runner/audit-accounts.txt", "utf8").trim().split("\n");
const [E1, P1] = l1.split(" ");
const [E2, P2] = l2.split(" ");
const VP = { 390: { width: 390, height: 844 }, 1440: { width: 1440, height: 900 } };

const manifest = [];
const failures = [];
mkdirSync(OUT, { recursive: true });

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28);
}

async function probe(page) {
  return page.evaluate(() => {
    const txt = document.body.innerText || "";
    const h1 = document.querySelector("main h1, h1");
    const rows = document.querySelectorAll("tbody tr").length;
    const empty = /Nothing here|No opportunities yet|No subcontractors|nothing to|None yet|is empty|No results|no records/i.test(txt);
    const err = /Something went wrong|Unhandled|Application error|500|stack trace/i.test(txt);
    return { h1: h1 ? h1.textContent.trim().slice(0, 60) : "(none)", rows, empty, err, chars: txt.length };
  });
}

async function capture(page, { file, route, role, vw, state, note }) {
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  manifest.push({ file, route, role, viewport: `${vw}px`, state, note: note || "", sha: SHA });
  console.log(`saved ${file}  [${route} | ${role} | ${vw}px | ${state}]`);
}

async function login(ctx, email, password) {
  const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email, password } });
  if (!res.ok()) throw new Error(`login failed: ${res.status()}`);
}

const OWNER_TARGETS = [
  ["opportunity-detail", `/opportunity/${OPP}`, true],
  ["opportunity-requirements", `/opportunity/${OPP}/requirements`, false],
  ["subcontractor-detail", `/subs/${SUB}`, true],
  ["workbench", "/workbench", false],
  ["review", "/review", false],
  ["call-queue", "/call-queue", false],
  ["communications", "/communications", false],
  ["contracts", "/contracts", false],
  ["compliance", "/compliance", false],
  ["automation-health", "/automation", false],
  ["settings-rules", "/settings/rules", false],
  ["settings-integrations", "/settings/integrations", false],
  ["settings-billing", "/settings/billing", false],
  ["settings-notifications", "/settings/notifications", false],
  ["settings-account", "/settings/account", false],
  ["more", "/more", false],
];
const ADMIN_TARGETS = [
  ["admin-account-detail", `/admin/accounts/${ORG1}`, false],
  ["admin-audit-log", "/admin/audit", false],
];

const browser = await chromium.launch({ executablePath: EXE });

async function sweep(targets, role, email, password, prefix) {
  const ctx = await browser.newContext({ viewport: VP[1440] });
  await login(ctx, email, password);
  const page = await ctx.newPage();
  for (const [key, route, hasTabs] of targets) {
    for (const vw of [390, 1440]) {
      const file = `${prefix}${key}-${vw}.png`;
      try {
        await page.setViewportSize(VP[vw]);
        const resp = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 180000 });
        await page.waitForTimeout(1500);
        const landed = new URL(page.url()).pathname;
        const p = await probe(page);
        const state = p.err ? "error" : landed !== route ? `redirected to ${landed}` : p.empty && p.rows === 0 ? "empty" : "populated";
        await capture(page, { file, route, role, vw, state, note: `h1="${p.h1}" rows=${p.rows} http=${resp ? resp.status() : "?"}` });
      } catch (e) {
        failures.push({ route, role, viewport: vw, error: String(e).slice(0, 200) });
        console.log(`FAILED ${route} @${vw}: ${String(e).slice(0, 160)}`);
      }
    }
    if (!hasTabs) continue;
    for (const vw of [390, 1440]) {
      try {
        await page.setViewportSize(VP[vw]);
        await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 180000 });
        await page.waitForTimeout(1000);
        const tabs = await page.getByRole("tab").all();
        if (!tabs.length) { failures.push({ route, role, viewport: vw, error: "no role=tab controls found" }); continue; }
        for (let i = 0; i < tabs.length; i++) {
          const name = (await tabs[i].textContent())?.trim() || `tab-${i}`;
          try {
            await tabs[i].click({ timeout: 8000 });
            await page.waitForTimeout(900);
            await capture(page, {
              file: `${prefix}${key}-tab-${slug(name)}-${vw}.png`,
              route, role, vw, state: `tab: ${name}`,
            });
          } catch (e) {
            failures.push({ route, role, viewport: vw, error: `tab "${name}": ${String(e).slice(0, 120)}` });
          }
        }
      } catch (e) {
        failures.push({ route, role, viewport: vw, error: `tab sweep: ${String(e).slice(0, 160)}` });
      }
    }
  }
  return { ctx, page };
}

// ---- owner of the populated synthetic tenant (also platform admin) ----
const owner = await sweep(OWNER_TARGETS, "owner (populated tenant)", E1, P1, "");
await sweep(ADMIN_TARGETS, "platform admin", E1, P1, "");

// ---- interactions: quick look, row menu, mobile nav ----
const page = owner.page;
try {
  await page.setViewportSize(VP[1440]);
  await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle", timeout: 180000 });
  await page.getByText("Quick look", { exact: false }).first().click({ timeout: 10000 });
  await page.waitForTimeout(2500);
  await capture(page, { file: "pipeline-quicklook-drawer-1440.png", route: "/pipeline", role: "owner (populated tenant)", vw: 1440, state: "quick-look drawer open" });
} catch (e) { failures.push({ route: "/pipeline quick look", error: String(e).slice(0, 200) }); }

try {
  await page.goto(`${BASE}/pipeline`, { waitUntil: "networkidle", timeout: 180000 });
  await page.locator('button:has-text("…"), button[aria-haspopup="menu"], button[aria-label*="more" i]').first().click({ timeout: 10000 });
  await page.waitForTimeout(1200);
  await capture(page, { file: "pipeline-row-menu-open-1440.png", route: "/pipeline", role: "owner (populated tenant)", vw: 1440, state: "row action menu open" });
} catch (e) { failures.push({ route: "/pipeline row menu", error: String(e).slice(0, 200) }); }

try {
  await page.setViewportSize(VP[390]);
  await page.goto(`${BASE}/today`, { waitUntil: "networkidle", timeout: 180000 });
  await page.locator('button[aria-label*="menu" i], button[aria-label*="navigation" i], header button').first().click({ timeout: 10000 });
  await page.waitForTimeout(1200);
  await capture(page, { file: "mobile-nav-open-390.png", route: "/today", role: "owner (populated tenant)", vw: 390, state: "mobile navigation menu open" });
} catch (e) { failures.push({ route: "/today mobile nav", error: String(e).slice(0, 200) }); }

try {
  await page.setViewportSize(VP[1440]);
  await page.goto(`${BASE}/subs/00000000-0000-4000-8000-0000000000ee`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1200);
  await capture(page, { file: "error-missing-subcontractor-1440.png", route: "/subs/<nonexistent-id>", role: "owner (populated tenant)", vw: 1440, state: "error: record does not exist" });
} catch (e) { failures.push({ route: "/subs/<nonexistent>", error: String(e).slice(0, 200) }); }

// ---- empty tenant equivalents ----
const ctx2 = await browser.newContext({ viewport: VP[1440] });
await login(ctx2, E2, P2);
const p2 = await ctx2.newPage();
for (const route of ["/workbench", "/review", "/call-queue", "/communications", "/contracts", "/compliance", "/automation"]) {
  const key = route.replace("/", "");
  try {
    await p2.setViewportSize(VP[1440]);
    await p2.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 180000 });
    await p2.waitForTimeout(1200);
    const pr = await probe(p2);
    await capture(p2, { file: `empty-${key}-1440.png`, route, role: "owner (empty tenant)", vw: 1440, state: pr.err ? "error" : "empty tenant", note: `h1="${pr.h1}" rows=${pr.rows}` });
  } catch (e) { failures.push({ route, role: "owner (empty tenant)", error: String(e).slice(0, 200) }); }
}

await browser.close();
writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ sha: SHA, captured: manifest, failures }, null, 2));
console.log(`\nDONE. files=${manifest.length} failures=${failures.length}`);
for (const f of failures) console.log("FAILURE", JSON.stringify(f));
