import { chromium, devices } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const shots = [
  ["pipeline", "/theme-qa/pipeline"],
  ["call", "/theme-qa/call"],
  ["brief", "/theme-qa/brief"],
  ["nav", "/theme-qa/nav"],
];
const out = "/tmp/claude-0/-home-user-government-contracting/a96ab8d3-3f99-55b4-a072-aab40e0f3903/scratchpad";
for (const [name, path] of shots) {
  for (const [suffix, ctxOpts] of [
    ["mobile", devices["iPhone 13"]],
    ["desktop", { viewport: { width: 1440, height: 900 } }],
  ]) {
    const ctx = await b.newContext(ctxOpts);
    const p = await ctx.newPage();
    await p.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${out}/${name}-${suffix}.png`, fullPage: name !== "pipeline" });
    await ctx.close();
  }
}
await b.close();
console.log("done");
