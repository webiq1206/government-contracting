import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { queryOne } from "@/lib/db";
import { readActivity, activityCsv } from "@/lib/activity/read";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  if (!auth.organizationId)
    return NextResponse.json({ error: "No account found." }, { status: 403 });
  try {
    const params = new URL(req.url).searchParams;
    if (params.get("format") === "csv") {
      const orgId = auth.organizationId;
      const ceiling = await queryOne<{ id: string }>(
        "select coalesce(max(id),0)::text id from activity_events where org_id=$1",
        [orgId],
      );
      let page = 1;
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async pull(controller) {
          try {
            params.set("page", String(page));
            const data = await readActivity(orgId, params, ceiling!.id);
            const csv = activityCsv(data.rows);
            controller.enqueue(
              encoder.encode(
                (page === 1 ? csv : csv.slice(csv.indexOf("\r\n") + 2)) +
                  "\r\n",
              ),
            );
            if (page * data.pageSize >= data.summary.total) controller.close();
            else page++;
          } catch (e) {
            controller.error(e);
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="activity-ledger.csv"',
          "Cache-Control": "no-store",
        },
      });
    }
    const data = await readActivity(auth.organizationId, params);
    return NextResponse.json(
      { ...data, viewScope: auth.organizationId + ":" + auth.id },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Activity could not be loaded. Check the filters and retry." },
      { status: 503 },
    );
  }
}
