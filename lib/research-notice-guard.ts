import { queryOne } from "./db";
import { RESEARCH_NOTICE_READ_ONLY } from "./domain/research-notice";

/** For write endpoints whose existing service does not load the notice kind. */
export async function bidWorkflowAccessProblem(opportunityId: string, orgId: string): Promise<{
  error: string; status: 404 | 409;
} | null> {
  const row = await queryOne<{ is_sources_sought: boolean | null }>(
    "select is_sources_sought from opportunities where id=$1 and org_id=$2", [opportunityId, orgId],
  );
  if (!row) return { error: "No such opportunity.", status: 404 };
  return row.is_sources_sought ? { error: RESEARCH_NOTICE_READ_ONLY, status: 409 } : null;
}
