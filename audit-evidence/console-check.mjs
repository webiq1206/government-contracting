import { chromium } from "playwright";
const BASE = "http://127.0.0.1:3100";
const EXE = "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";
const browser = await chromium.launch({ executablePath: EXE });
for (const path of ["/", "/login", "/signup"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const msgs = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") msgs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e) => msgs.push(`pageerror: ${String(e).slice(0, 300)}`));
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(2500);
  console.log(`\n===== ${path} =====`);
  console.log(msgs.length ? msgs.join("\n---\n") : "(no console errors or warnings)");
  await ctx.close();
}
await browser.close();
