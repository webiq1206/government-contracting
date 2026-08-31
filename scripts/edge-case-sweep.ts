/**
 * Every page against the data conditions that break pages.
 *
 * A seeded account is the one dataset an interface is never tested against in
 * the wild. Real ones are empty on day one, hold exactly one of something for
 * a week, and eventually contain a subcontractor whose legal name is ninety
 * characters of punctuation. Those three shapes break different things --
 * empty breaks the "here is your data" assumption, one-record breaks
 * pluralisation and aggregate arithmetic, and long strings break layout -- and
 * none of them is visible from the seeded middle.
 *
 * Three passes, each on its own throwaway organization so nothing leaks
 * between them:
 *
 *   empty   a brand-new account with nothing in it
 *   single  exactly one of each record type
 *   hostile long names, missing values, contradictory dates, unicode
 *
 * What it looks for, per page: a crash, a 5xx, horizontal overflow, and the
 * lie this codebase has fought hardest -- a value that is unknown being
 * rendered as `0`.
 *
 * Destructive, and local-only for the same reason perf-sweep is.
 *
 * Run: npx tsx scripts/edge-case-sweep.ts --base http://localhost:3100
 */
import { chromium, type Page, type BrowserContext } from "playwright";
import { query, queryOne } from "../lib/db";
import { hashPassword } from "../lib/auth";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = arg("--base") ?? "http://localhost:3100";
const TAG = "edge-sweep";
const PASSWORD = "EdgeCase123!";

const ROUTES = [
  "/today",
  "/workbench",
  "/pipeline",
  "/review",
  "/call-queue",
  "/subs",
  "/communications",
  "/contracts",
  "/compliance",
  "/analytics",
  "/agents",
  "/settings/profile",
  "/settings/rules",
  "/settings/content",
  "/settings/integrations",
];

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function assertLocal() {
  const url = process.env.DATABASE_URL ?? "";
  const local =
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    url.includes("host=/tmp") ||
    url.startsWith("postgresql:///");
  if (!local) throw new Error("edge-case-sweep refuses to run against a non-local DATABASE_URL.");
}

interface Finding {
  scenario: string;
  route: string;
  rule: string;
  detail: string;
}

/** A name nobody would choose and somebody will eventually have. */
const LONG_NAME =
  "Þórsson-McAllister & Sons Mechanical Contracting, Heating, Ventilation, " +
  "Air Conditioning and Refrigeration Services of the Greater Metropolitan Area, LLC";

async function makeOrg(label: string): Promise<{ orgId: string; email: string }> {
  const email = `${TAG}-${label}@example.invalid`;
  const org = await queryOne<{ id: string }>(
    `insert into organizations (name, subscription_status, billing_exempt)
     values ($1, 'active', true) returning id`,
    [`${TAG} ${label}`]
  );
  const orgId = org!.id;
  const user = await queryOne<{ id: string }>(
    `insert into users (email, password_hash, name, role)
     values ($1, $2, $3, 'operator')
     on conflict (email) do update set password_hash = excluded.password_hash
     returning id`,
    [email, hashPassword(PASSWORD), `${TAG} ${label}`]
  );
  await query(
    `insert into organization_members (org_id, user_id, role) values ($1, $2, 'owner')
     on conflict (org_id, user_id) do nothing`,
    [orgId, user!.id]
  );
  return { orgId, email };
}

async function seedSingle(orgId: string) {
  await query(
    `insert into opportunities (org_id, source, title, agency, stage, tier, status, score, deadline)
     values ($1, 'manual', $2, 'One Agency', 'outreach', 'pursue', 'open', 72, now() + interval '10 days')`,
    [orgId, `${TAG} the only opportunity`]
  );
  await query(
    `insert into subcontractors (org_id, company_name, trade_categories, city, state, email, phone)
     values ($1, $2, array['electrical'], 'Boise', 'ID', 'one@example.invalid', '555-0100')`,
    [orgId, `${TAG} the only subcontractor`]
  );
}

async function seedHostile(orgId: string) {
  // Long name, no agency, no score, and a deadline already in the past: each
  // is a thing the interface has to say something honest about.
  await query(
    `insert into opportunities (org_id, source, title, agency, stage, tier, status, score, deadline, description)
     values ($1, 'manual', $2, null, 'quote_entry', null, 'open', null, now() - interval '3 days', $3)`,
    [orgId, LONG_NAME + " -- Solicitation for Comprehensive Facilities Support", repeat(LONG_NAME, 4)]
  );
  // A second one with no deadline at all, which is the case that produced
  // "On track" against nothing.
  await query(
    `insert into opportunities (org_id, source, title, agency, stage, tier, status, score, deadline)
     values ($1, 'manual', $2, 'Agency With A Very Long Name Indeed For Testing Purposes', 'analysis', 'review', 'open', null, null)`,
    [orgId, `${TAG} no deadline, no score`]
  );
  await query(
    `insert into subcontractors (org_id, company_name, trade_categories, city, state, email, phone)
     values ($1, $2, array['electrical','plumbing','hvac','roofing','concrete','masonry'], $3, 'ID', null, null)`,
    [orgId, LONG_NAME, "A City With An Unreasonably Long Name For Layout Testing"]
  );
  /*
   * 'incomplete', not 'ok'.
   *
   * Migration 091 put a check constraint on this column and 'ok' has not been
   * one of the eight allowed states since. The sweep threw while seeding, so
   * it had been measuring nothing at all: an item with no expiry date is
   * exactly the case it exists to catch, and the state that describes it is
   * 'incomplete'.
   */
  await query(
    `insert into compliance_items (org_id, label, category, status, due_at, source)
     values ($1, $2, 'sam_registration', 'incomplete', null, 'operator')`,
    [orgId, `${TAG} item with no expiry date`]
  );
}

function repeat(s: string, n: number): string {
  return Array.from({ length: n }, () => s).join(" ");
}

async function cleanup() {
  const orgs = await query<{ id: string }>(`select id from organizations where name like $1`, [`${TAG}%`]);
  for (const { id } of orgs) {
    /*
     * Every org-scoped table, not just the ones the sweep writes to directly.
     * Rendering a page can write too -- `agent_logs` picks up a line from the
     * automation status the moment a scenario loads a dashboard -- and the
     * only symptom was a foreign key violation in teardown that left the
     * throwaway org and its rows behind for the next run to trip over.
     */
    for (const t of [
      "agent_logs", "conversation_flags", "compliance_items", "communications",
      "call_cards", "quotes", "bids", "documents", "opportunities",
      "subcontractors", "organization_members",
    ]) {
      await query(`delete from ${t} where org_id = $1`, [id]).catch(() => {});
    }
    await query(`delete from organizations where id = $1`, [id]);
  }
  await query(`delete from users where email like $1`, [`${TAG}%`]);
}

async function login(page: Page, email: string) {
  // Each scenario is a different account in the same browser, so the previous
  // one's session cookie is still there and /login just redirects to /today.
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 40000 });
  await page.fill("input[type=email]", email);
  await page.fill("input[type=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 40000 });
}

/**
 * A figure rendered as `0` next to a label that suggests nobody counted.
 *
 * Deliberately narrow: it looks for a zero paired with wording about a value
 * that has to be derived, not for every zero on the page. Zero replies really
 * is zero, and flagging it would bury the case that matters.
 */
const UNKNOWN_AS_ZERO = /(score|confidence|value|rate|margin|coverage)[^.<]{0,24}\b0\b(?!%)/i;

async function sweep(
  ctx: BrowserContext,
  scenario: string,
  email: string,
  findings: Finding[]
) {
  const page = await ctx.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) =>
    r.fulfill({ status: 200, contentType: "text/css", body: "" })
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });

  await login(page, email);

  for (const route of ROUTES) {
    errors.length = 0;
    try {
      await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 40000 });
    } catch {
      findings.push({ scenario, route, rule: "load", detail: "timed out" });
      continue;
    }
    for (const e of errors) findings.push({ scenario, route, rule: "error", detail: e });

    const probe = await page.evaluate(() => {
      const main = document.querySelector("main") ?? document.body;
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        text: (main.textContent ?? "").replace(/\s+/g, " ").slice(0, 6000),
        // A page that renders a heading and nothing else is a page that gave
        // up quietly, which is the shape the work queue failure had.
        bodyLength: (main.textContent ?? "").trim().length,
      };
    });

    if (probe.overflow) {
      findings.push({ scenario, route, rule: "overflow", detail: "page scrolls horizontally" });
    }
    if (probe.bodyLength < 120) {
      findings.push({
        scenario, route, rule: "blank",
        detail: `only ${probe.bodyLength} characters rendered`,
      });
    }
    const zero = probe.text.match(UNKNOWN_AS_ZERO);
    if (zero) {
      findings.push({ scenario, route, rule: "unknown-as-zero", detail: zero[0].slice(0, 80) });
    }
  }
  await page.close();
}

async function main() {
  assertLocal();
  if (process.argv.includes("--clean")) {
    await cleanup();
    console.error("[edge] cleaned.");
    return;
  }

  await cleanup();
  const empty = await makeOrg("empty");
  const single = await makeOrg("single");
  await seedSingle(single.orgId);
  const hostile = await makeOrg("hostile");
  await seedHostile(hostile.orgId);

  const findings: Finding[] = [];
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

  // Mobile as well as desktop: long strings and empty states break differently
  // at 390px, and that is the width the audit cares most about.
  for (const vp of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.name === "mobile",
    });
    for (const [label, who] of [
      ["empty", empty],
      ["single", single],
      ["hostile", hostile],
    ] as const) {
      await sweep(ctx, `${label}/${vp.name}`, who.email, findings);
    }
    await ctx.close();
  }
  await browser.close();

  const out: string[] = [];
  out.push("# Edge-case report");
  out.push("");
  out.push("Generated by `npx tsx scripts/edge-case-sweep.ts` against a running server.");
  out.push("");
  out.push(
    "Three throwaway organizations, each swept at desktop and mobile: **empty** (a brand-new " +
      "account), **single** (exactly one of each record), and **hostile** (very long names, " +
      "missing agency, no score, a deadline in the past, one with no deadline at all, and a " +
      "compliance item with no expiry)."
  );
  out.push("");
  out.push(`${ROUTES.length} routes x 3 scenarios x 2 widths. **${findings.length} findings.**`);
  out.push("");
  if (findings.length === 0) {
    out.push("No crashes, no 5xx, no horizontal overflow, no blank pages, no unknowns shown as zero.");
  } else {
    out.push("| Scenario | Route | Rule | Detail |");
    out.push("| --- | --- | --- | --- |");
    for (const f of findings) {
      out.push(`| ${f.scenario} | \`${f.route}\` | ${f.rule} | ${f.detail.replace(/\|/g, "\\|")} |`);
    }
  }
  out.push("");
  out.push("Run `npx tsx scripts/edge-case-sweep.ts --clean` to remove the throwaway accounts.");
  out.push("");

  mkdirSync(join(process.cwd(), "docs"), { recursive: true });
  writeFileSync(join(process.cwd(), "docs/edge-case-report.md"), out.join("\n"));
  console.error(`[edge] ${findings.length} findings -> docs/edge-case-report.md`);
  const byRule = new Map<string, number>();
  for (const f of findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
  for (const [rule, n] of byRule) console.error(`[edge]   ${rule}: ${n}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[edge] failed:", e);
    process.exit(1);
  });
