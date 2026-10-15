import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { queryOne } from '@/lib/db';
import { BOUNDARY_VERSION,databaseIdentity,runtimeBuild,safeWorkerEvidence } from '@/lib/runtime-evidence';

export const dynamic = 'force-dynamic';
export async function GET() {
  const auth = await requirePlatformAdmin();
  if (auth instanceof Response) return auth;
  const headers = { 'Cache-Control':'private, no-store' };
  try {
    const [heartbeat,database]=await Promise.all([
      queryOne(`select instance_id,phase,booted_at,updated_at,runtime_evidence from worker_heartbeat where id='worker'`),
      databaseIdentity(),
    ]);
    return NextResponse.json({ observedAt:new Date().toISOString(),
      web:{build:runtimeBuild,boundaryVersion:BOUNDARY_VERSION,database},
      heartbeat:safeWorkerEvidence(heartbeat),
      limitations:'Git commit/tree evidence requires a clean readable checkout. The versioned source-input digest can be compared with a reviewed checkout even when Git evidence is unavailable; it covers the declared build-input scope, not the entire repository, installed dependencies, environment, or external services. A digest is a build attestation, not an independent signature. The connection fingerprint describes the observed database name/address/port tuple; it is not a verified cluster or billing-account identity. One heartbeat does not prove job completion or that every old executor has drained.' },{headers});
  } catch {
    return NextResponse.json({error:'Worker evidence is unavailable.'},{status:503,headers});
  }
}
