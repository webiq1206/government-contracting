/**
 * Authenticated Light/Dark × desktop/mobile screenshots of every product route.
 * No password required: mint a cookie first with:
 *   npx tsx scripts/qa-session.ts
 *
 * Usage: node scripts/live-theme-qa.mjs [baseUrl]
 */
import { chromium, devices } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const base = process.argv[2] || "http://127.0.0.1:3000";
const token = readFileSync("/tmp/brost-qa-session.txt", "utf8").trim();
if (!token) throw new Error("Missing /tmp/brost-qa-session.txt — run npx tsx scripts/qa-session.ts");

const outDir = join(process.cwd(), ".theme-qa", "live-full");
mkdirSync(outDir, { recursive: true });

const STATIC_ROUTES = [
  "/today",
  "/pipeline",
  "/review",
  "/call-queue",
  "/subs",
  "/contracts",
  "/compliance",
  "/agents",
  "/email-log",
  "/analytics",
  "/authority",
  "/how-it-works",
  "/settings/profile",
  "/settings/rules",
  "/settings/content",
  "/settings/integrations",
  "/settings/billing",
];

const themes = ["light", "dark"];
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  {
    name: "mobile",
    width: devices["iPhone 13"].viewport.width,
    height: devices["iPhone 13"].viewport.height,
    isMobile: true,
    hasTouch: true,
  },
];

async function forceTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem("brost.theme", t);
    document.cookie = `brost.theme=${t}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.classList.toggle("dark", t === "dark");
    document.documentElement.style.colorScheme = t;
  }, theme);
  const btn = page.getByRole("button", {
    name: theme === "dark" ? "Dark" : "Light",
    exact: true,
  });
  if (await btn.count()) {
    try {
      await btn.first().click({ timeout: 1200 });
    } catch {
      /* covered / missing */
    }
  }
  await page.evaluate((t) => {
    document.documentElement.classList.toggle("dark", t === "dark");
    document.documentElement.style.colorScheme = t;
  }, theme);
}

async function probe(page) {
  return page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const dark = document.documentElement.classList.contains("dark");
    const suspects = [];
    for (const el of document.querySelectorAll("body *")) {
      if (!(el instanceof HTMLElement)) continue;
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 48 || rect.height < 24) continue;
      const b = s.backgroundColor;
      if (!b.startsWith("rgb") || b === "rgba(0, 0, 0, 0)") continue;
      const m = b.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?/);
      if (!m) continue;
      const alpha = m[4] != null ? Number(m[4]) : 1;
      if (alpha < 0.25) continue;
      const [r, g, bl] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * bl) / 255;
      if (dark && lum > 0.85 && rect.width * rect.height > 10000) {
        suspects.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || "").slice(0, 90),
          bg: b,
        });
      }
      if (!dark && lum < 0.06 && rect.width * rect.height > 16000 && !el.closest("aside,nav")) {
        suspects.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || "").slice(0, 90),
          bg: b,
        });
      }
      if (suspects.length >= 6) break;
    }
    const h1 = document.querySelector("h1")?.textContent?.trim() ?? "";
    const bodySnippet = (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 180);
    return {
      dark,
      bg: cs.getPropertyValue("--background").trim(),
      fg: cs.getPropertyValue("--foreground").trim(),
      title: document.title,
      h1,
      bodySnippet,
      suspects,
      url: location.pathname + location.search,
      statusText: document.body?.innerText?.includes("Application error")
        ? "app-error"
        : null,
    };
  });
}

async function discoverIds(context, theme) {
  const page = await context.newPage();
  await page.addInitScript((t) => localStorage.setItem("brost.theme", t), theme);
  const found = { opportunityId: null, subId: null };
  try {
    await page.goto(`${base}/pipeline`, { waitUntil: "networkidle", timeout: 60000 });
    await forceTheme(page, theme);
    found.opportunityId = await page.evaluate(() => {
      const a = document.querySelector('a[href^="/opportunity/"]');
      return a?.getAttribute("href")?.match(/\/opportunity\/([^/?#]+)/)?.[1] ?? null;
    });
    await page.goto(`${base}/subs`, { waitUntil: "networkidle", timeout: 60000 });
    await forceTheme(page, theme);
    found.subId = await page.evaluate(() => {
      const a = document.querySelector('a[href^="/subs/"]');
      return a?.getAttribute("href")?.match(/\/subs\/([^/?#]+)/)?.[1] ?? null;
    });
  } catch {
    /* ignore discovery failures */
  }
  await page.close();
  return found;
}

const browser = await chromium.launch({ headless: true });
const report = [];
let discovered = { opportunityId: null, subId: null };

for (const theme of themes) {
  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: !!vp.isMobile,
      hasTouch: !!vp.hasTouch,
      colorScheme: theme,
    });
    await context.addCookies([
      {
        name: "brostco_session",
        value: token,
        url: base,
        httpOnly: true,
        sameSite: "Lax",
      },
      { name: "brost.theme", value: theme, url: base, sameSite: "Lax" },
    ]);

    if (!discovered.opportunityId && !discovered.subId) {
      discovered = await discoverIds(context, theme);
    }

    const routes = [...STATIC_ROUTES];
    if (discovered.opportunityId) routes.splice(4, 0, `/opportunity/${discovered.opportunityId}`);
    else routes.splice(4, 0, "/opportunity/__missing__");
    if (discovered.subId) routes.splice(6, 0, `/subs/${discovered.subId}`);
    else routes.splice(6, 0, "/subs/__missing__");

    for (const route of routes) {
      const page = await context.newPage();
      await page.addInitScript((t) => localStorage.setItem("brost.theme", t), theme);
      let status = "ok";
      let sample = null;
      let file = null;
      try {
        if (route.includes("__missing__")) {
          status = "skip-no-record";
          report.push({
            theme,
            viewport: vp.name,
            route: route.replace("__missing__", ":id"),
            status,
            file: null,
            sample: null,
          });
          await page.close();
          continue;
        }
        const res = await page.goto(`${base}${route}`, {
          waitUntil: "networkidle",
          timeout: 60000,
        });
        await forceTheme(page, theme);
        await page.waitForTimeout(250);
        if (!res || !res.ok()) status = `http-${res?.status() ?? "none"}`;
        sample = await probe(page);
        if (sample.url.includes("/login")) status = "redirect-login";
        if (sample.url.includes("/signup")) status = "redirect-signup";
        if (sample.statusText === "app-error") status = "app-error";
        if (sample.suspects.length && status === "ok") status = "suspect-surfaces";
        const safe = route.replace(/[^\w/-]+/g, "").replace(/\//g, "_") || "root";
        file = `${theme}-${vp.name}${safe}.png`;
        const scroller = page.locator(".scroll-thin, main.page-main, main").first();
        if (await scroller.count()) {
          await scroller.evaluate((el) => {
            el.scrollTop = 0;
          }).catch(() => {});
        }
        await page.screenshot({ path: join(outDir, file), fullPage: false });
      } catch (err) {
        status = String(err.message || err).slice(0, 180);
      }
      report.push({ theme, viewport: vp.name, route, status, file, sample });
      await page.close();
    }
    await context.close();
  }
}

await browser.close();
const out = { outDir, discovered, report };
writeFileSync(join(outDir, "report.json"), JSON.stringify(out, null, 2));

const counts = {};
for (const r of report) counts[r.status] = (counts[r.status] || 0) + 1;
console.log(
  JSON.stringify(
    {
      outDir,
      discovered,
      counts,
      issues: report.filter((r) => r.status !== "ok" && r.status !== "skip-no-record"),
    },
    null,
    2
  )
);
