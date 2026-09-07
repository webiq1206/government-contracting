/*
 * Third evidence pass over the isolated audit copy at SHA 1a05f5ef.
 * Inspection only: navigates, opens tabs/dialogs/menus, scrolls page and inner
 * panes, screenshots each visible step. Never submits a form or triggers a send.
 * Screenshots are viewport-sized (fullPage:false) so inner scrollers are real.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:3100";
const EXE = "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";
const OUT = "/home/runner/workspace/audit-evidence";
const SHA = "1a05f5eff7c3de7783b69d8b1e0a262910147f57";
const OPP = "b8d4e7f8-ab28-4919-a320-9bb64e0ef11b";
const SUB = "24692bfd-c653-4b56-b5c5-0442932ac8b0";
const GHOST_OPP = "00000000-0000-4000-8000-0000000000dd";
const GHOST_SUB = "00000000-0000-4000-8000-0000000000ee";

const [l1, l2] = readFileSync("/home/runner/audit-accounts.txt", "utf8").trim().split("\n");
const [E1, P1] = l1.split(" ");
const [E2, P2] = l2.split(" ");
const VP = { 390: { width: 390, height: 844 }, 1440: { width: 1440, height: 900 } };

const manifest = [];
const failures = [];
const problems = [];
mkdirSync(OUT, { recursive: true });

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 26);

let currentRoute = "(none)";
function watch(page) {
  page.on("console", (m) => {
    if (m.type() === "error") problems.push({ kind: "console", route: currentRoute, text: m.text().slice(0, 220) });
  });
  page.on("pageerror", (e) => problems.push({ kind: "pageerror", route: currentRoute, text: String(e).slice(0, 220) }));
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push({ kind: "http", route: currentRoute, text: `${r.status()} ${r.url().replace(BASE, "").slice(0, 140)}` });
  });
}

async function shot(page, { file, route, role, vw, state, scroll }) {
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: false });
  manifest.push({ file, route, role, viewport: `${vw}px`, state, scroll, sha: SHA });
  console.log(`saved ${file} :: ${route} | ${role} | ${vw}px | ${state} | ${scroll}`);
}

/** Scroll the window through all content, capturing overlapping viewport steps. */
async function scrollCapture(page, { key, route, role, vw, state }) {
  const step = Math.round(VP[vw].height * 0.8);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  let y = 0;
  let i = 1;
  for (;;) {
    const info = await page.evaluate(() => ({
      y: Math.round(window.scrollY),
      max: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    }));
    await shot(page, { file: `${key}-${vw}-p${i}.png`, route, role, vw, state, scroll: `page y=${info.y}px of ${info.max}px` });
    if (info.y >= info.max - 4 || i >= 12) break;
    y += step;
    await page.evaluate((ny) => window.scrollTo(0, ny), y);
    await page.waitForTimeout(500);
    i += 1;
  }
  return i;
}

/** Find inner scrollers and step each one through its content. */
async function paneCapture(page, { key, route, role, vw, state }) {
  const panes = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("*").forEach((el) => {
      const cs = getComputedStyle(el);
      const scrolls = /(auto|scroll)/.test(cs.overflowY);
      if (!scrolls) return;
      if (el.scrollHeight <= el.clientHeight + 48) return;
      if (el.clientHeight < 180) return;
      const r = el.getBoundingClientRect();
      if (r.width < 120) return;
      const id = el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.className?.toString().split(" ").slice(0, 2).join(".") || el.tagName.toLowerCase();
      el.setAttribute("data-audit-pane", String(out.length));
      out.push({ idx: out.length, id: String(id).slice(0, 40), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
    });
    return out.slice(0, 3);
  });
  let n = 0;
  for (const pane of panes) {
    const steps = Math.min(8, Math.ceil((pane.scrollHeight - pane.clientHeight) / (pane.clientHeight * 0.8)) + 1);
    for (let s = 0; s < steps; s++) {
      const pos = await page.evaluate(
        ([idx, s]) => {
          const el = document.querySelector(`[data-audit-pane="${idx}"]`);
          if (!el) return null;
          el.scrollTop = Math.round(el.clientHeight * 0.8 * s);
          return { top: Math.round(el.scrollTop), max: el.scrollHeight - el.clientHeight };
        },
        [pane.idx, s],
      );
      if (!pos) break;
      await page.waitForTimeout(400);
      await shot(page, {
        file: `${key}-${vw}-pane${pane.idx}-s${s + 1}.png`,
        route,
        role,
        vw,
        state: `${state} (inner pane "${pane.id}")`,
        scroll: `pane top=${pos.top}px of ${pos.max}px`,
      });
      n += 1;
      if (pos.top >= pos.max - 4) break;
    }
  }
  return n;
}

async function visit(page, route, vw) {
  currentRoute = route;
  await page.setViewportSize(VP[vw]);
  const resp = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 240000 });
  await page.waitForTimeout(1600);
  const state = await page.evaluate(() => {
    const txt = document.body.innerText || "";
    return {
      landed: location.pathname + location.search,
      err: /This page did not load|Something went wrong|Application error|Unhandled/i.test(txt),
      empty: /Nothing here|No opportunities|No subcontractors|None yet|is empty|No results|nothing to do/i.test(txt),
      rows: document.querySelectorAll("tbody tr, [data-row], li[data-id]").length,
      h1: (document.querySelector("main h1, h1")?.textContent || "").trim().slice(0, 60),
    };
  });
  return { status: resp ? resp.status() : 0, ...state };
}

function label(route, s) {
  if (s.err) return "error boundary";
  if (s.landed !== route && !route.includes("?")) return `redirected to ${s.landed}`;
  if (s.empty && s.rows === 0) return "empty";
  return "populated";
}

const browser = await chromium.launch({ executablePath: EXE });

// ---------- populated tenant ----------
const ctx = await browser.newContext({ viewport: VP[1440] });
await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: E1, password: P1 } });
const page = await ctx.newPage();
watch(page);
const OWNER = "owner (populated tenant)";

for (const vw of [390, 1440]) {
  // ---- opportunity detail + every tab ----
  try {
    const s = await visit(page, `/opportunity/${OPP}`, vw);
    const st = label(`/opportunity/${OPP}`, s);
    console.log(`\n== /opportunity @${vw} -> ${st} (h1="${s.h1}" http=${s.status}) ==`);
    await scrollCapture(page, { key: "v2-opportunity-detail", route: `/opportunity/${OPP}`, role: OWNER, vw, state: st });
    await paneCapture(page, { key: "v2-opportunity-detail", route: `/opportunity/${OPP}`, role: OWNER, vw, state: st });

    const tabs = await page.getByRole("tab").all();
    console.log(`tabs found: ${tabs.length}`);
    if (!tabs.length) failures.push({ route: `/opportunity/${OPP}`, vw, error: "no role=tab controls rendered" });
    for (let i = 0; i < tabs.length; i++) {
      const name = ((await tabs[i].textContent()) || `tab-${i}`).trim();
      try {
        await tabs[i].click({ timeout: 12000 });
        await page.waitForTimeout(1200);
        const key = `v2-opportunity-tab-${slug(name)}`;
        await scrollCapture(page, { key, route: `/opportunity/${OPP}`, role: OWNER, vw, state: `tab: ${name}` });
        await paneCapture(page, { key, route: `/opportunity/${OPP}`, role: OWNER, vw, state: `tab: ${name}` });
      } catch (e) {
        failures.push({ route: `/opportunity/${OPP}`, vw, error: `tab "${name}": ${String(e).slice(0, 140)}` });
      }
    }
  } catch (e) {
    failures.push({ route: `/opportunity/${OPP}`, vw, error: String(e).slice(0, 180) });
  }

  // ---- routine routes ----
  const routes = [
    ["v2-today", "/today"],
    ["v2-opportunities", "/pipeline"],
    ["v2-review", "/review"],
    ["v2-subs", "/subs"],
    ["v2-settings-billing", "/settings/billing"],
    ["v2-settings-notifications", "/settings/notifications"],
    ["v2-settings-account", "/settings/account"],
  ];
  for (const [key, route] of routes) {
    try {
      const s = await visit(page, route, vw);
      const st = label(route, s);
      console.log(`\n== ${route} @${vw} -> ${st} (h1="${s.h1}" rows=${s.rows} http=${s.status}) ==`);
      await scrollCapture(page, { key, route, role: OWNER, vw, state: st });
      await paneCapture(page, { key, route, role: OWNER, vw, state: st });
    } catch (e) {
      failures.push({ route, vw, error: String(e).slice(0, 180) });
    }
  }

  // ---- subcontractor Quotes tab ----
  try {
    const s = await visit(page, `/subs/${SUB}`, vw);
    const st = label(`/subs/${SUB}`, s);
    const tabs = await page.getByRole("tab").all();
    let hit = false;
    for (const t of tabs) {
      const name = ((await t.textContent()) || "").trim();
      if (!/quote/i.test(name)) continue;
      hit = true;
      await t.click({ timeout: 12000 });
      await page.waitForTimeout(1200);
      await scrollCapture(page, { key: "v2-sub-quotes-tab", route: `/subs/${SUB}`, role: OWNER, vw, state: `tab: ${name} (${st})` });
      await paneCapture(page, { key: "v2-sub-quotes-tab", route: `/subs/${SUB}`, role: OWNER, vw, state: `tab: ${name}` });
    }
    if (!hit) failures.push({ route: `/subs/${SUB}`, vw, error: "no Quotes tab found" });
  } catch (e) {
    failures.push({ route: `/subs/${SUB} quotes`, vw, error: String(e).slice(0, 180) });
  }

  // ---- Subcontractors "All filters" dialog ----
  try {
    await visit(page, "/subs", vw);
    const btn = page.getByRole("button", { name: /all filters|filters/i }).first();
    await btn.click({ timeout: 12000 });
    await page.waitForTimeout(1200);
    await scrollCapture(page, { key: "v2-subs-all-filters-dialog", route: "/subs", role: OWNER, vw, state: "All filters dialog open" });
    await paneCapture(page, { key: "v2-subs-all-filters-dialog", route: "/subs", role: OWNER, vw, state: "All filters dialog open" });
    await page.keyboard.press("Escape");
  } catch (e) {
    failures.push({ route: "/subs all filters", vw, error: String(e).slice(0, 180) });
  }

  // ---- row action menu on the opportunities list ----
  try {
    await visit(page, "/pipeline", vw);
    await page.getByRole("button", { name: /More actions for/i }).first().click({ timeout: 12000 });
    await page.waitForTimeout(1000);
    await scrollCapture(page, { key: "v2-opportunities-row-menu", route: "/pipeline", role: OWNER, vw, state: "row action menu open" });
    await page.keyboard.press("Escape");
  } catch (e) {
    failures.push({ route: "/pipeline row menu", vw, error: String(e).slice(0, 180) });
  }

  // ---- quick look drawer ----
  try {
    currentRoute = `/pipeline?peek=${OPP}`;
    await page.setViewportSize(VP[vw]);
    await page.goto(`${BASE}/pipeline?peek=${OPP}`, { waitUntil: "networkidle", timeout: 240000 });
    await page.waitForTimeout(2200);
    await scrollCapture(page, { key: "v2-quicklook-drawer", route: "/pipeline?peek=<opportunity-id>", role: OWNER, vw, state: "quick-look drawer open" });
    await paneCapture(page, { key: "v2-quicklook-drawer", route: "/pipeline?peek=<opportunity-id>", role: OWNER, vw, state: "quick-look drawer open" });
  } catch (e) {
    failures.push({ route: "/pipeline?peek", vw, error: String(e).slice(0, 180) });
  }

  // ---- missing records ----
  for (const [key, route] of [
    ["v2-error-missing-opportunity", `/opportunity/${GHOST_OPP}`],
    ["v2-error-missing-subcontractor", `/subs/${GHOST_SUB}`],
  ]) {
    try {
      const s = await visit(page, route, vw);
      await scrollCapture(page, { key, route: route.replace(GHOST_OPP, "<nonexistent-id>").replace(GHOST_SUB, "<nonexistent-id>"), role: OWNER, vw, state: `missing record (http ${s.status})` });
    } catch (e) {
      failures.push({ route, vw, error: String(e).slice(0, 180) });
    }
  }
}

// ---------- empty tenant ----------
const ctx2 = await browser.newContext({ viewport: VP[1440] });
await ctx2.request.post(`${BASE}/api/auth/login`, { data: { email: E2, password: P2 } });
const p2 = await ctx2.newPage();
watch(p2);
const EMPTY = "owner (empty tenant)";
for (const vw of [390, 1440]) {
  for (const [key, route] of [
    ["v2-empty-workbench", "/workbench"],
    ["v2-empty-contracts", "/contracts"],
    ["v2-forbidden-admin", "/admin"],
  ]) {
    try {
      const s = await visit(p2, route, vw);
      const st = route === "/admin" ? `not permitted for this role (http ${s.status})` : label(route, s);
      console.log(`\n== ${route} @${vw} [empty tenant] -> ${st} ==`);
      await scrollCapture(p2, { key, route, role: EMPTY, vw, state: st });
      await paneCapture(p2, { key, route, role: EMPTY, vw, state: st });
    } catch (e) {
      failures.push({ route, vw, role: EMPTY, error: String(e).slice(0, 180) });
    }
  }
}

await browser.close();
writeFileSync(`${OUT}/manifest-v2.json`, JSON.stringify({ sha: SHA, captured: manifest, failures, problems }, null, 2));
console.log(`\nDONE files=${manifest.length} failures=${failures.length} problems=${problems.length}`);
for (const f of failures) console.log("FAILURE", JSON.stringify(f));
const seen = new Set();
for (const p of problems) {
  const k = `${p.kind}|${p.route}|${p.text}`;
  if (seen.has(k)) continue;
  seen.add(k);
  console.log("PROBLEM", JSON.stringify(p));
}
