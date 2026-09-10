import { queryOne } from "../db";
import { LEGACY_ORG_ID } from "../tenant-context";
export interface BounceCursor { after_sec: number; scan_started_sec: number; page_token: string | null }
export async function loadBounceCursor(lookbackMinutes: number): Promise<BounceCursor> {
  const started = Math.floor(Date.now() / 1000);
  const row = await queryOne<BounceCursor>(`insert into mailbox_scan_cursors(org_id,purpose,after_sec,scan_started_sec)
    values($1,'recap-bounces',$2,$3) on conflict(org_id,purpose) do update set purpose=excluded.purpose
    returning after_sec,scan_started_sec,page_token`, [LEGACY_ORG_ID, started - lookbackMinutes * 60, started]);
  if (!row) throw new Error("Could not load the bounce scan position.");
  return row;
}
export async function saveBounceCursor(cursor: BounceCursor, next?: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const saved = await queryOne<{ org_id: string }>(`update mailbox_scan_cursors
    set after_sec=$2,scan_started_sec=$3,page_token=$4,updated_at=now()
    where org_id=$1 and purpose='recap-bounces' and after_sec=$5 and scan_started_sec=$6
      and page_token is not distinct from $7::text returning org_id`,
    [LEGACY_ORG_ID, next ? cursor.after_sec : Math.max(1, Number(cursor.scan_started_sec) - 300),
      next ? cursor.scan_started_sec : now, next ?? null,
      cursor.after_sec, cursor.scan_started_sec, cursor.page_token]);
  if (!saved) throw new Error("Another inbox scan changed the position. Saved replies are safe; the next run will continue from that position.");
}
export async function restartBouncePage(cursor: BounceCursor): Promise<void> {
  await queryOne(`update mailbox_scan_cursors set page_token=null, updated_at=now()
    where org_id=$1 and purpose='recap-bounces' and page_token=$2 returning org_id`, [LEGACY_ORG_ID, cursor.page_token]);
}
