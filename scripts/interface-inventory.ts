/**
 * The interface, counted.
 *
 * A redesign of this size fails in one specific way: a page nobody remembered
 * gets left on the old pattern, and a control nobody could name gets dropped
 * because its purpose was unclear. Both are invisible until a customer hits
 * them. The defence is a list that is generated rather than written, so it
 * cannot quietly go stale the way a hand-maintained one does.
 *
 * What this reads, per page: the route, the file, whether it wears the shared
 * PageFrame, its title and one-sentence explanation, whether it names a single
 * primary action, and which of the five non-data states it actually handles
 * (loading, empty, error, permission, disconnected). Those last ones are the
 * ones that get skipped, and skipping them is what makes a failure look like
 * an empty list.
 *
 * It reports rather than judges. A page with no PageFrame may be right to have
 * none -- the vendor portal and the marketing pages are not operator surfaces.
 * The output is the input to a decision, not the decision.
 *
 * Run: npx tsx scripts/interface-inventory.ts [--json]
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

interface PageRecord {
  route: string;
  file: string;
  kind: "page" | "api" | "layout";
  group: string;
  frame: boolean;
  title: string | null;
  explanation: string | null;
  primaryAction: boolean;
  breadcrumbs: boolean;
  states: string[];
  tables: string[];
  drawer: boolean;
  lines: number;
}

/** Every file under a directory, depth-first, skipping the usual noise. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * The URL a file answers on.
 *
 * Route groups -- the `(dash)` and `(account)` parentheses -- are Next's way
 * of sharing a layout without adding a path segment, so they come out of the
 * URL entirely. Getting this wrong would list every operator page under a
 * prefix that does not exist and make the inventory unusable for checking
 * links.
 */
function routeOf(file: string): string {
  const rel = relative(join(ROOT, "app"), file);
  const parts = rel.split("/");
  parts.pop();
  const segs = parts.filter((p) => !(p.startsWith("(") && p.endsWith(")")));
  return "/" + segs.join("/");
}

/** A quoted string that follows a named JSX prop or object key. */
function propString(src: string, name: string): string | null {
  const m =
    src.match(new RegExp(`${name}\\s*=\\s*"([^"]{1,200})"`)) ??
    src.match(new RegExp(`${name}\\s*:\\s*"([^"]{1,200})"`));
  return m ? m[1] : null;
}

const STATE_MARKERS: [string, RegExp][] = [
  ["loading", /LoadingRows|Skeleton|Suspense/],
  ["empty", /EmptyState|NothingHere/],
  ["error", /ErrorState/],
  ["permission", /PermissionState|notFound\(\)|isPlatformAdmin/],
  ["disconnected", /not[- ]connected|disconnected|Reconnect|needsReconnect/i],
];

/**
 * A route segment inherits `loading.tsx` and `error.tsx` from itself or any
 * ancestor, so reading only the page file reports a boundary as missing when
 * the group above it already provides one. The first pass did exactly that and
 * accused twenty-four pages of having no error state when `app/(dash)` covers
 * all of them. An inventory that cries wolf gets ignored, which is worse than
 * not having one.
 */
function inheritedBoundary(file: string, name: string): boolean {
  let dir = join(file, "..");
  const stop = join(ROOT, "app");
  for (;;) {
    if (existsSync(join(dir, name))) return true;
    if (dir === stop || dir.length <= stop.length) return false;
    dir = join(dir, "..");
  }
}

const TABLE_MARKERS: [string, RegExp][] = [
  ["DataTable", /\bDataTable\b/],
  ["FilterToolbar", /\bFilterToolbar\b/],
  ["raw <table>", /<table\b/],
  ["board", /pipeline-dnd|PipelineDnd/],
];

function inspect(file: string): PageRecord | null {
  const rel = relative(ROOT, file);
  if (!/\.(tsx|ts)$/.test(rel)) return null;
  const base = rel.split("/").pop()!;
  const kind: PageRecord["kind"] =
    base === "page.tsx" ? "page" : base === "route.ts" ? "api" : base === "layout.tsx" ? "layout" : "page";
  if (!["page.tsx", "route.ts", "layout.tsx"].includes(base)) return null;

  const src = readFileSync(file, "utf8");
  const groupMatch = rel.match(/app\/\(([^)]+)\)/);

  return {
    route: routeOf(file),
    file: rel,
    kind,
    group: groupMatch ? groupMatch[1] : rel.startsWith("app/api/") ? "api" : "root",
    frame: /\bPageFrame\b/.test(src),
    title: propString(src, "title"),
    explanation: propString(src, "explanation"),
    primaryAction: /primaryAction/.test(src),
    breadcrumbs: /breadcrumbs/.test(src),
    states: (() => {
      const found = STATE_MARKERS.filter(([, re]) => re.test(src)).map(([n]) => n);
      if (!found.includes("loading") && inheritedBoundary(file, "loading.tsx")) found.push("loading*");
      if (!found.includes("error") && inheritedBoundary(file, "error.tsx")) found.push("error*");
      return found.sort();
    })(),
    tables: TABLE_MARKERS.filter(([, re]) => re.test(src)).map(([n]) => n),
    drawer: /ContextDrawer/.test(src),
    lines: src.split("\n").length,
  };
}

function main() {
  const files = walk(join(ROOT, "app"));
  const records = files.map(inspect).filter((r): r is PageRecord => r !== null);

  const pages = records.filter((r) => r.kind === "page");
  const apis = records.filter((r) => r.kind === "api");
  const layouts = records.filter((r) => r.kind === "layout");

  const components = readdirSync(join(ROOT, "components")).filter((f) => f.endsWith(".tsx"));
  const domain = readdirSync(join(ROOT, "lib/domain")).filter((f) => f.endsWith(".ts"));

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ pages, apis, layouts, components, domain }, null, 2));
    return;
  }

  /*
   * Three pages carry a frame of their own rather than the shared one, and
   * each is deliberate:
   *
   *   /today            the greeting IS the frame -- date, role-aware
   *                     headline, the workload sentence, the count. The
   *                     audit specifies exactly that shape for this page.
   *   /opportunity/[id] a sticky record header carrying the deadline, stage,
   *                     score, confidence, owner and readiness, plus its own
   *                     pinned "back to Opportunities" bar.
   *   /settings         a redirect to the first tab. There is no page to
   *                     frame.
   *   /email-log        a redirect to /communications, kept so links people
   *                     already have do not 404. Same reason as /settings:
   *                     there is no page here to frame.
   *
   * Named individually so a fifth one has to be argued for rather than
   * quietly joining them.
   */
  const OWN_FRAME = new Set(["/today", "/opportunity/[id]", "/settings", "/email-log"]);

  const out: string[] = [];
  out.push("# Interface inventory");
  out.push("");
  out.push(
    "Generated by `npx tsx scripts/interface-inventory.ts`. Do not edit by hand: rerun it."
  );
  out.push("");
  out.push(
    `${pages.length} pages, ${apis.length} API routes, ${layouts.length} layouts, ` +
      `${components.length} components, ${domain.length} domain modules.`
  );
  out.push("");
  out.push("## Operator pages");
  out.push("");
  out.push(
    "`Frame` is the shared PageFrame (breadcrumb, title, one-sentence explanation, one primary action). " +
      "`own` means the page carries an equivalent frame of its own for a stated reason; see the script. " +
      "`States` lists the non-data states the page handles. A starred entry is inherited from an " +
      "ancestor route boundary rather than handled in the page itself, which catches the crash but " +
      "cannot say what failed."
  );
  out.push("");
  out.push("| Route | Frame | Primary action | Crumbs | States | Table | Drawer | Lines |");
  out.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const p of pages.filter((r) => r.group === "dash" || r.group === "account").sort((a, b) => a.route.localeCompare(b.route))) {
    out.push(
      `| \`${p.route}\` | ${p.frame ? "yes" : OWN_FRAME.has(p.route) ? "own" : "**no**"} | ${p.primaryAction ? "yes" : "no"} | ` +
        `${p.breadcrumbs ? "yes" : "no"} | ${p.states.join(", ") || "**none**"} | ` +
        `${p.tables.join(", ") || "-"} | ${p.drawer ? "yes" : "-"} | ${p.lines} |`
    );
  }
  out.push("");
  out.push("## Pages outside the dashboard shell");
  out.push("");
  out.push("Auth, onboarding, marketing, the vendor portal and the theme QA harness.");
  out.push("");
  out.push("| Route | Group | States | Lines |");
  out.push("| --- | --- | --- | --- |");
  for (const p of pages.filter((r) => r.group !== "dash" && r.group !== "account").sort((a, b) => a.route.localeCompare(b.route))) {
    out.push(`| \`${p.route}\` | ${p.group} | ${p.states.join(", ") || "-"} | ${p.lines} |`);
  }
  out.push("");
  out.push("## API routes");
  out.push("");
  for (const a of apis.sort((x, y) => x.route.localeCompare(y.route))) {
    out.push(`- \`${a.route}\``);
  }
  out.push("");
  out.push("## Components");
  out.push("");
  out.push(components.map((c) => `\`${c.replace(/\.tsx$/, "")}\``).join(", "));
  out.push("");
  out.push("## Domain modules");
  out.push("");
  out.push(domain.map((d) => `\`${d.replace(/\.ts$/, "")}\``).join(", "));
  out.push("");

  mkdirSync(join(ROOT, "docs"), { recursive: true });
  writeFileSync(join(ROOT, "docs/interface-inventory.md"), out.join("\n"));
  console.error(
    `[inventory] ${pages.length} pages, ${apis.length} API routes -> docs/interface-inventory.md`
  );

  const noFrame = pages.filter(
    (p) => (p.group === "dash" || p.group === "account") && !p.frame && !OWN_FRAME.has(p.route)
  );
  const noError = pages.filter(
    (p) =>
      (p.group === "dash" || p.group === "account") &&
      !p.states.includes("error") &&
      !p.states.includes("error*")
  );
  if (noFrame.length) {
    console.error(`[inventory] no PageFrame: ${noFrame.map((p) => p.route).join(", ")}`);
  } else {
    console.error("[inventory] every operator page carries a frame.");
  }
  if (noError.length) console.error(`[inventory] no error state: ${noError.map((p) => p.route).join(", ")}`);
}

main();
