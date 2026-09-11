/** Server-render checks against disposable fixtures. Does not drive a browser. */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tsImport } from "tsx/esm/api";
import { startDatabase } from "./local-database.mjs";
const { db, server } = await startDatabase();
const out = "artifacts/redesign/server-renders";
mkdirSync(out, { recursive: true });
const fixtures = JSON.parse(readFileSync("/tmp/ui-fixtures.json", "utf8"));
// Refresh only the disposable portal fixture with the application's signer.
// Keep this short-lived token in memory and out of published evidence.
const portalModule = await tsImport("../../lib/domain/sub-portal-link.ts", import.meta.url);
const encodePortalToken = portalModule.encodePortalToken || portalModule.default?.encodePortalToken;
fixtures.vendorToken = encodePortalToken({s: fixtures.sub, e: Math.floor(Date.now() / 1000) + 3600});
const env = {
  ...process.env,
  NODE_ENV: "production",
  BROSTCO_BUILD_DIR: ".next-release",
  APP_URL: "http://127.0.0.1:3188",
};
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3188"],
  { env, stdio: ["ignore", "pipe", "pipe"] },
);
let log = "";
child.stdout.on("data", (x) => {
  log += x;
});
child.stderr.on("data", (x) => {
  log += x;
});
const base = "http://127.0.0.1:3188";
const results = [];
function redirectTarget(response, html) {
  const header = response.headers.get("location");
  if (header) return header;
  // Use the browser redirect tag, not an escaped copy in the Flight payload.
  return html.match(/<meta[^>]+http-equiv="refresh"[^>]+content="\d+;url=([^"]+)"/)?.[1]?.replaceAll("&amp;", "&") || null;
}
try {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(base + "/login", {
        signal: AbortSignal.timeout(2000),
      });
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const login = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "ui-owner@example.test",
      password: "DisposableUiAudit123!",
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!login.ok) throw Error("Disposable sign-in failed: " + login.status);
  const cookie = login.headers
    .getSetCookie()
    .map((x) => x.split(";")[0])
    .join("; ");
  if (!cookie) throw Error("No session established for fixture test.");
  function files(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((x) =>
      x.isDirectory()
        ? files(join(dir, x.name))
        : x.name === "page.tsx"
          ? [join(dir, x.name)]
          : [],
    );
  }
  const pages = files("app")
    .filter((x) => !x.includes("/theme-qa/"))
    .map((file) => ({
      file,
      route:
        file === "app/page.tsx"
          ? "/"
          : "/" +
            file
              .replace(/^app\//, "")
              .replace(/\/page.tsx$/, "")
              .replace(/\([^/]+\)\//g, ""),
    }));
  for (const page of pages) {
    if (page.route === "/page.tsx") page.route = "/";
    if (page.route.includes("[id]"))
      page.route = page.route.replace(
        "[id]",
        page.route.includes("/admin/accounts")
          ? fixtures.org
          : page.route.includes("/opportunity")
            ? fixtures.opportunity
            : page.route.includes("/subs")
              ? fixtures.sub
              : fixtures.contract,
      );
    if (page.route.includes("[token]"))
      page.route = page.route.replace("[token]", fixtures.vendorToken);
    try {
      const start = Date.now();
      const response = await fetch(base + page.route, {
        headers:
          page.file.includes("/(dash)/") ||
          page.file.includes("/(account)/") ||
          page.route.startsWith("/billing/")
            ? { cookie }
            : {},
        redirect: "manual",
        signal: AbortSignal.timeout(45000),
      });
      const html = await response.text();
      const name =
        page.route.split("?")[0].replace(/[^a-zA-Z0-9]/g, "_") || "home";
      if (!page.route.startsWith("/vendor/"))
        writeFileSync(join(out, name + ".html"), html);
      const errors = [
        "Application error: a server-side exception",
        "NEXT_HTTP_ERROR_FALLBACK;500",
        "This page could not be loaded",
        "We could not load this page",
      ].filter((x) => html.includes(x));
      if (page.route.startsWith("/vendor/") && html.includes("This link has expired")) errors.push("Fresh fixture portal link was rejected");
      const item = {
        file: page.file,
        route: page.route.startsWith("/vendor/")
          ? "/vendor/[token]"
          : page.route,
        status: response.status,
        redirect: redirectTarget(response, html),
        durationMs: Date.now() - start,
        bytes: html.length,
        errors,
        html: page.route.startsWith("/vendor/") ? null : name + ".html",
      };
      results.push(item);
      writeFileSync(
        "artifacts/redesign/route-render-results.json",
        JSON.stringify(results, null, 2),
      );
      console.log(JSON.stringify({ ...item, html: undefined }));
    } catch (error) {
      results.push({
        file: page.file,
        route: page.route.startsWith("/vendor/") ? "/vendor/[token]" : page.route,
        error: page.route.startsWith("/vendor/") ? "Vendor fixture render failed" : error.message,
      });
      console.log("Render failed: " + page.file);
    }
  }
  // Check genuine server authorization separately from visual evidence.
  const denied = await fetch(
    base + "/api/views?page=brostco.opportunities.views",
    { redirect: "manual" },
  );
  results.push({
    test: "anonymous private API access denied",
    status: denied.status,
    pass: denied.status === 401,
  });
  const after = await fetch(
    base + "/api/views?page=brostco.opportunities.views",
    { headers: { cookie } },
  );
  results.push({
    test: "authenticated saved views available",
    status: after.status,
    pass: after.status === 200,
  });
  for (const [route, expected] of [
    ["/opportunities?q=facility&view=table", "/pipeline?q=facility&view=table"],
    ["/email-log?q=fixture&status=failed", "/communications?q=fixture&filter=delivery_failed"],
    ["/automation", "/agents"],
    ["/settings", "/settings/profile"],
    ["/admin", "/admin/accounts"],
  ]) {
    const response = await fetch(base + route, {headers: {cookie}, redirect: "manual"});
    const html = await response.text();
    const actual = redirectTarget(response, html);
    results.push({test: "compatibility redirect " + route, actual, expected, pass: actual === expected});
  }
  const fixtureEndpoint = await fetch(base + "/theme-qa/screens?page=today", {headers: {cookie}});
  results.push({test: "fixture screen endpoint unavailable in production", status: fixtureEndpoint.status, pass: fixtureEndpoint.status === 404});
} finally {
  writeFileSync(
    "artifacts/redesign/route-render-results.json",
    JSON.stringify(results, null, 2),
  );
  writeFileSync("artifacts/redesign/server.log", log);
  child.kill("SIGTERM");
  await server.stop();
  await db.close();
}
// Explicitly passing rejection checks may correctly return 401 or 404.
const failures = results.filter((item) => item.error || item.errors?.length || (item.status >= 400 && !item.pass) || item.pass === false);
if (failures.length) process.exitCode = 1;
