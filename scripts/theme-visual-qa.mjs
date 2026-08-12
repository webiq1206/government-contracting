/**
 * Visual QA: Light/Dark × desktop/mobile screenshots for theme surfaces.
 * Usage: node scripts/theme-visual-qa.mjs [baseUrl]
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "fs";
import { join } from "path";

const base = process.argv[2] || "http://127.0.0.1:3000";
const outDir = join(process.cwd(), ".theme-qa");
mkdirSync(outDir, { recursive: true });

const routes = ["/theme-qa", "/login", "/signup"];
const themes = ["light", "dark"];
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", ...devices["iPhone 13"].viewport, isMobile: true, hasTouch: true },
];

async function applyTheme(page, theme) {
  await page.addInitScript((t) => {
    localStorage.setItem("brost.theme", t);
    document.cookie = `brost.theme=${t}; Path=/; Max-Age=31536000; SameSite=Lax`;
    const root = document.documentElement;
    root.classList.toggle("dark", t === "dark");
    root.style.colorScheme = t;
  }, theme);
}

async function contrastSample(page) {
  return page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    const bg = styles.getPropertyValue("--background").trim();
    const fg = styles.getPropertyValue("--foreground").trim();
    const muted = styles.getPropertyValue("--muted-foreground").trim();
    const surface = styles.getPropertyValue("--surface").trim();
    const hasDark = document.documentElement.classList.contains("dark");
    return { bg, fg, muted, surface, hasDark, title: document.title };
  });
}

const browser = await chromium.launch({ headless: true });
const report = [];

for (const theme of themes) {
  for (const vp of viewports) {
    for (const route of routes) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: !!vp.isMobile,
        hasTouch: !!vp.hasTouch,
        colorScheme: theme,
      });
      const page = await context.newPage();
      await applyTheme(page, theme);
      const url = `${base}${route}`;
      let status = "ok";
      try {
        const res = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
        if (!res || !res.ok()) status = `http-${res?.status() ?? "none"}`;
        // Force theme after navigation in case script raced.
        await page.evaluate((t) => {
          localStorage.setItem("brost.theme", t);
          document.documentElement.classList.toggle("dark", t === "dark");
          document.documentElement.style.colorScheme = t;
        }, theme);
        await page.waitForTimeout(250);
        const sample = await contrastSample(page);
        const file = `${theme}-${vp.name}${route.replace(/\//g, "_") || "_home"}.png`;
        await page.screenshot({ path: join(outDir, file), fullPage: true });
        report.push({ theme, viewport: vp.name, route, status, file, sample });
      } catch (err) {
        status = String(err.message || err);
        report.push({ theme, viewport: vp.name, route, status, file: null, sample: null });
      }
      await context.close();
    }
  }
}

await browser.close();
console.log(JSON.stringify({ outDir, report }, null, 2));
