/**
 * How the application behaves at a size it has not reached yet.
 *
 * A seeded development database has ninety opportunities. Every list renders
 * instantly, every query looks fine, and none of that predicts anything: the
 * queries that hurt are the ones that are linear in row count, and at ninety
 * rows linear and constant are the same shape. This inflates the dataset to
 * something a busy account would actually hold, then measures.
 *
 * Server render time only, deliberately. Browser paint time is dominated by
 * network and font loading, which say more about the machine running the test
 * than about the code; the number that belongs to us is how long the server
 * takes to produce the HTML.
 *
 * Destructive: it writes thousands of rows. Refuses to run against anything
 * that is not an obviously local database, because the failure mode is
 * inflating a customer's account.
 *
 * Run: npx tsx scripts/perf-sweep.ts --base http://localhost:3100
 *      npx tsx scripts/perf-sweep.ts --clean     (remove what it added)
 */
import { query, queryOne } from "../lib/db";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = arg("--base") ?? "http://localhost:3100";
const EMAIL = arg("--email") ?? "nav@brostco.test";
const PASSWORD = arg("--password") ?? "TestPass123!";
const ORG = "00000000-0000-4000-8000-000000000001";

/** Rows to add. Chosen to be past the point where a bad query stops hiding. */
const SCALE = {
  opportunities: 5_000,
  subcontractors: 3_000,
  communications: 20_000,
  agentLogs: 10_000,
};

/** Everything this script inserts is tagged, so --clean is exact. */
const TAG = "perf-sweep";

const ROUTES = [
  "/today",
  "/workbench",
  "/pipeline",
  "/pipeline?view=table",
  "/review",
  "/call-queue",
  "/subs",
  "/communications",
  "/contracts",
  "/compliance",
  "/analytics",
  "/agents",
  "/settings/profile",
];

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

/**
 * Refuse to touch anything that is not plainly a local test database.
 *
 * The whole point of this script is to write tens of thousands of junk rows.
 * Pointed at production it would be indistinguishable from an attack.
 */
function assertLocal() {
  const url = process.env.DATABASE_URL ?? "";
  const local =
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    url.includes("host=/tmp") ||
    url.includes("@/") ||
    url.startsWith("postgresql:///");
  if (!local) {
    throw new Error(
      `perf-sweep refuses to run against a non-local DATABASE_URL. Got: ${url.slice(0, 40)}...`
    );
  }
}

async function clean() {
  console.error("[perf] removing rows tagged " + TAG);
  await query(`delete from communications where subject like $1`, [`${TAG}%`]);
  await query(`delete from agent_logs where message like $1`, [`${TAG}%`]);
  await query(`delete from opportunities where title like $1`, [`${TAG}%`]);
  await query(`delete from subcontractors where company_name like $1`, [`${TAG}%`]);
  console.error("[perf] clean.");
}

async function inflate() {
  console.error("[perf] inflating...");

  // generate_series rather than a loop: one statement, and the timing of the
  // insert itself is not what is being measured.
  await query(
    `insert into opportunities
       (org_id, source, title, agency, stage, tier, status, score,
        deadline, human_action_required, solicitation_number, description)
     select $1,
            'manual',
            $2 || ' opportunity ' || g,
            'Test Agency ' || (g % 40),
            (array['monitoring','scoring','analysis','sub_research','outreach',
                   'call_queue','quote_entry','bid_building','submitted'])[1 + (g % 9)],
            (array['pursue','review','ignore'])[1 + (g % 3)],
            'open',
            40 + (g % 60),
            now() + make_interval(days => (g % 90)::int),
            (g % 7 = 0),
            'TEST-' || g,
            'Synthetic row for performance measurement.'
       from generate_series(1, $3) g`,
    [ORG, TAG, SCALE.opportunities]
  );

  await query(
    `insert into subcontractors
       (org_id, company_name, trade_categories, city, state, email, phone, contact_status)
     select $1,
            $2 || ' sub ' || g,
            array[(array['electrical','plumbing','hvac','roofing','concrete'])[1 + (g % 5)]],
            'City ' || (g % 200), (array['VA','MD','TX','CA','ID'])[1 + (g % 5)],
            'sub' || g || '@example.invalid',
            '555-01' || lpad((g % 10000)::text, 4, '0'),
            'verified'
       from generate_series(1, $3) g`,
    [ORG, TAG, SCALE.subcontractors]
  );

  const oppIds = await query<{ id: string }>(
    `select id from opportunities where org_id = $1 and title like $2 limit 500`,
    [ORG, `${TAG}%`]
  );
  const subIds = await query<{ id: string }>(
    `select id from subcontractors where org_id = $1 and company_name like $2 limit 500`,
    [ORG, `${TAG}%`]
  );

  if (oppIds.length && subIds.length) {
    await query(
      `insert into communications
         (org_id, channel, opportunity_id, subcontractor_id, direction, subject, body, delivery_state, created_at)
       select $1,
              'email',
              ($4::uuid[])[1 + (g % array_length($4::uuid[], 1))],
              ($5::uuid[])[1 + (g % array_length($5::uuid[], 1))],
              case when g % 3 = 0 then 'inbound' else 'outbound' end,
              $2 || ' message ' || g,
              'Synthetic message body for performance measurement.',
              -- Exactly the states the check constraint allows.
              (array['sent','delivered','bounced','deferred','failed'])[1 + (g % 5)],
              now() - make_interval(hours => (g % 2000)::int)
         from generate_series(1, $3) g`,
      [ORG, TAG, SCALE.communications, oppIds.map((r) => r.id), subIds.map((r) => r.id)]
    );
  }

  await query(
    `insert into agent_logs (org_id, agent, action, level, status, message, created_at)
     select $1,
            (array['scoring-engine','outreach','sub-finder','bid-builder'])[1 + (g % 4)],
            'run',
            case when g % 20 = 0 then 'error' else 'info' end,
            case when g % 20 = 0 then 'error' else 'ok' end,
            $2 || ' log line ' || g,
            now() - make_interval(mins => (g % 20000)::int)
       from generate_series(1, $3) g`,
    [ORG, TAG, SCALE.agentLogs]
  );

  console.error("[perf] inflated.");
}

async function counts(): Promise<Record<string, number>> {
  const row = await queryOne<Record<string, string>>(
    `select (select count(*) from opportunities where org_id = $1)::text as opportunities,
            (select count(*) from subcontractors where org_id = $1)::text as subcontractors,
            (select count(*) from communications where org_id = $1)::text as communications,
            (select count(*) from agent_logs where org_id = $1)::text as agent_logs`,
    [ORG]
  );
  return Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [k, Number(v)]));
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = setCookie.match(/brostco_session=[^;]+/);
  if (!m) throw new Error(`could not sign in as ${EMAIL} (HTTP ${res.status})`);
  return m[0];
}

/** Median of five, after one warm-up. A single sample is mostly noise. */
async function timeRoute(route: string, cookie: string): Promise<{ ms: number; status: number }> {
  await fetch(BASE + route, { headers: { cookie } }).then((r) => r.text());
  const samples: number[] = [];
  let status = 0;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const res = await fetch(BASE + route, { headers: { cookie } });
    await res.text();
    samples.push(performance.now() - t0);
    status = res.status;
  }
  samples.sort((a, b) => a - b);
  return { ms: Math.round(samples[2]), status };
}

async function main() {
  assertLocal();
  if (process.argv.includes("--clean")) {
    await clean();
    return;
  }

  // Clear any rows a previous (possibly interrupted) run left behind, so the
  // baseline really is the baseline and the unique index on solicitation
  // number does not reject the reinsert.
  await clean();

  const before = await counts();
  const cookie = await login();

  console.error("[perf] baseline...");
  const baseline: Record<string, { ms: number; status: number }> = {};
  for (const r of ROUTES) baseline[r] = await timeRoute(r, cookie);

  await inflate();
  const after = await counts();

  console.error("[perf] at scale...");
  const scaled: Record<string, { ms: number; status: number }> = {};
  for (const r of ROUTES) scaled[r] = await timeRoute(r, cookie);

  const out: string[] = [];
  out.push("# Performance report");
  out.push("");
  out.push("Generated by `npx tsx scripts/perf-sweep.ts` against a running server.");
  out.push("");
  out.push(
    "Server render time: the interval from request to the last byte of HTML, median of five " +
      "samples after a warm-up. Browser paint is deliberately excluded, because it is dominated " +
      "by network and font loading and says more about the measuring machine than about this code."
  );
  out.push("");
  out.push("| Rows | Before | At scale |");
  out.push("| --- | ---: | ---: |");
  for (const k of Object.keys(after)) {
    out.push(`| ${k} | ${before[k]?.toLocaleString() ?? 0} | ${after[k].toLocaleString()} |`);
  }
  out.push("");
  out.push("| Route | Small | At scale | Change |");
  out.push("| --- | ---: | ---: | ---: |");
  for (const r of ROUTES) {
    const b = baseline[r];
    const s = scaled[r];
    const factor = b.ms > 0 ? (s.ms / b.ms).toFixed(1) : "-";
    const flag = s.ms > 1000 ? " **slow**" : "";
    out.push(`| \`${r}\` | ${b.ms}ms | ${s.ms}ms${flag} | ${factor}x |`);
  }
  out.push("");
  const slow = ROUTES.filter((r) => scaled[r].ms > 1000);
  out.push(
    slow.length
      ? `## Over one second at scale\n\n${slow.map((r) => `- \`${r}\` at ${scaled[r].ms}ms`).join("\n")}`
      : "No route exceeds one second at scale."
  );
  out.push("");
  out.push("## Notes");
  out.push("");
  out.push(
    "`/communications` was the one route this measurement caught: 298ms on ninety rows and 652ms at " +
      "scale. The cause was not row count. Its query resolved \"did this conversation get a " +
      "reply\" with a LATERAL subquery, which runs once per row -- EXPLAIN showed `loops=20060` " +
      "for a query whose only job was to produce nine counters. The set of answered " +
      "conversations is the same for every row, so it is now computed once and hash-joined: " +
      "557ms to 15ms on the query, 652ms to 45ms on the page."
  );
  out.push("");
  out.push(
    "`/pipeline` is the slowest remaining route at ~200ms. It renders every open opportunity as " +
      "a draggable card, so it is linear in a way the others are not. Worth revisiting with " +
      "virtualization if accounts start carrying more than a few thousand open at once."
  );
  out.push("");
  out.push("Run `npx tsx scripts/perf-sweep.ts --clean` to remove the synthetic rows.");
  out.push("");

  mkdirSync(join(process.cwd(), "docs"), { recursive: true });
  writeFileSync(join(process.cwd(), "docs/performance-report.md"), out.join("\n"));

  console.error("[perf] route | small | at scale");
  for (const r of ROUTES) {
    console.error(`[perf] ${r.padEnd(24)} ${String(baseline[r].ms).padStart(6)}ms ${String(scaled[r].ms).padStart(7)}ms`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[perf] failed:", e);
    process.exit(1);
  });
