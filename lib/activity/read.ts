import { query } from "../db";
export const CATEGORIES = [
  "email",
  "sms",
  "call",
  "note",
  "bid",
  "quote",
  "reply",
  "document",
  "opportunity",
  "contract",
  "compliance",
  "automation",
  "api",
  "billing",
  "settings",
] as const;
export type ActivityRow = {
  id: string;
  occurred_at: string;
  category: string;
  title: string;
  status: string;
  actor: string;
  source_table: string;
  source_id: string;
  operation: string;
  historical: boolean;
  opportunity_id: string | null;
  opportunity: string | null;
  subcontractor_id: string | null;
  company: string | null;
  detail: Record<string, unknown>;
};
export async function readActivity(
  orgId: string,
  p: URLSearchParams,
  maxId?: string,
) {
  const values: unknown[] = [orgId];
  const where = ["e.org_id=$1"];
  const add = (sql: string, v: unknown) => {
    values.push(v);
    where.push(sql.replace("?", `$${values.length}`));
  };
  if (maxId) add("e.id<=?::bigint", maxId);
  for (const key of ["category", "status", "actor"])
    if (p.get(key)) add(`e.${key}=?`, p.get(key));
  if (p.get("opportunity"))
    add("e.opportunity_id=?::uuid", p.get("opportunity"));
  if (p.get("q"))
    add(
      "(e.title ilike ? or e.detail::text ilike ? or o.title ilike ? or s.company_name ilike ?)",
      `%${p
        .get("q")!
        .slice(0, 200)
        .replace(/[\\%_]/g, "\\$&")}%`,
    );
  // The search uses one parameter in each arm.
  if (p.get("q"))
    where[where.length - 1] = where[where.length - 1].replaceAll(
      "?",
      `$${values.length}`,
    );
  for (const key of ["from", "to"])
    if (p.get(key)) {
      const d = new Date(p.get(key)!);
      if (!Number.isFinite(+d)) throw new Error("Choose valid dates.");
      if (key === "to") d.setUTCDate(d.getUTCDate() + 1);
      add(
        `e.occurred_at${key === "from" ? ">=" : "<"}?::timestamptz`,
        d.toISOString(),
      );
    }
  if (p.get("attention") === "1")
    where.push(
      "e.status in ('failed','bounced','deferred','draft','needs_review','needs_matching','blocked','critical','warning')",
    );
  const page = Math.max(
    1,
    Math.min(100000, Math.floor(Number(p.get("page")) || 1)),
  );
  const join =
    "from activity_events e left join opportunities o on o.id=e.opportunity_id and o.org_id=e.org_id left join subcontractors s on s.id=e.subcontractor_id and s.org_id=e.org_id";
  const filter = where.join(" and ");
  const sort = p.get("sort") === "oldest" ? "asc" : "desc";
  const [rows, totals, options] = await Promise.all([
    query<ActivityRow>(
      `select e.id::text,e.occurred_at::text,e.category,e.title,e.status,e.actor,e.source_table,e.source_id,e.operation,e.historical,e.opportunity_id,o.title as opportunity,e.subcontractor_id,s.company_name as company,e.detail ${join} where ${filter} order by e.occurred_at ${sort},e.id ${sort} limit 50 offset ${(page - 1) * 50}`,
      values,
    ),
    query<{
      total: number;
      attention: number;
      sent: number;
      received: number;
      bids: number;
    }>(
      `select count(*)::int total,count(*) filter(where e.status in ('failed','bounced','deferred','draft','needs_review','needs_matching','blocked','critical','warning'))::int attention,count(*) filter(where e.category='email' and e.status in ('sent','delivered'))::int sent,count(*) filter(where e.status='received')::int received,count(*) filter(where e.category='bid')::int bids ${join} where ${filter}`,
      values,
    ),
    query<{ actor: string }>(
      "select distinct actor from activity_events where org_id=$1 order by actor limit 200",
      [orgId],
    ),
  ]);
  return {
    rows,
    summary: totals[0],
    actors: options.map((x) => x.actor),
    page,
    pageSize: 50,
  };
}
export function csvCell(value: unknown): string {
  const s = String(value ?? "");
  return (
    '"' + (/^[\s]*[=+@-]/.test(s) ? "'" : "") + s.replaceAll('"', '""') + '"'
  );
}
export function activityCsv(rows: ActivityRow[]) {
  return [
    [
      "Time",
      "Type",
      "Action",
      "Status",
      "Actor",
      "Opportunity",
      "Company",
      "Details",
      "Historical snapshot",
    ],
    ...rows.map((r) => [
      r.occurred_at,
      r.category,
      r.title,
      r.status,
      r.actor,
      r.opportunity,
      r.company,
      JSON.stringify(r.detail),
      r.historical,
    ]),
  ]
    .map((r) => r.map(csvCell).join(","))
    .join("\r\n");
}
