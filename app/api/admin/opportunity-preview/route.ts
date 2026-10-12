import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { activatePreview,dryRunPreview,executePreview,preparePreview,previewInputSchema,
  previewStatus,ProspectiveBlockedError,releasePreview } from '@/lib/prospective-boundary';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control':'private, no-store' };
const bodySchema = z.discriminatedUnion('action',[
  z.object({ action:z.literal('dry-run'),input:previewInputSchema }).strict(),
  z.object({ action:z.literal('prepare'),input:previewInputSchema }).strict(),
  z.object({ action:z.literal('activate'),id:z.string().uuid(),rolloutReference:z.string().min(12).max(1000) }).strict(),
  z.object({ action:z.literal('execute'),id:z.string().uuid() }).strict(),
  z.object({ action:z.literal('release'),id:z.string().uuid(),rolloutReference:z.string().min(12).max(1000) }).strict(),
]);
export async function GET(request:Request) {
  const auth = await requirePlatformAdmin();
  if (auth instanceof Response) return auth;
  const id = z.string().uuid().safeParse(new URL(request.url).searchParams.get('id'));
  if (!id.success) return NextResponse.json({error:'A preview ID is required.'},{status:400,headers});
  try { return NextResponse.json(await previewStatus(id.data),{headers}); }
  catch { return NextResponse.json({error:'Preview evidence is unavailable.'},{status:503,headers}); }
}
export async function POST(request:Request) {
  const auth = await requirePlatformAdmin();
  if (auth instanceof Response) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(()=>null));
  if (!parsed.success) return NextResponse.json({error:'Invalid preview request.'},{status:400,headers});
  const body = parsed.data;
  try {
    if (body.action === 'dry-run') return NextResponse.json(await dryRunPreview(body.input),{headers});
    if (body.action === 'prepare') return NextResponse.json(await preparePreview(body.input,auth.id),{headers});
    if (body.action === 'activate') await activatePreview(body.id,auth.id,body.rolloutReference);
    if (body.action === 'execute') await executePreview(body.id);
    if (body.action === 'release') await releasePreview(body.id,auth.id,body.rolloutReference);
    return NextResponse.json(await previewStatus(body.id),{headers});
  } catch(error) {
    return NextResponse.json({error:error instanceof ProspectiveBlockedError ? error.message :
      'Preview could not complete. Inspect its saved state; do not replay uncertain work.'},
      {status:error instanceof ProspectiveBlockedError ? 409 : 503,headers});
  }
}
