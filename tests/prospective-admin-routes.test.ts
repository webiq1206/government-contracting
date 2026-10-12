import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({auth:vi.fn(),dry:vi.fn(),prepare:vi.fn(),activate:vi.fn(),execute:vi.fn(),release:vi.fn(),status:vi.fn(),query:vi.fn(),database:vi.fn()}));
vi.mock('../lib/platform-admin',()=>({requirePlatformAdmin:m.auth}));
vi.mock('../lib/db',()=>({queryOne:m.query}));
vi.mock('../lib/prospective-boundary',async original=>({...(await original<typeof import('../lib/prospective-boundary')>()),
  dryRunPreview:m.dry,preparePreview:m.prepare,activatePreview:m.activate,executePreview:m.execute,releasePreview:m.release,previewStatus:m.status}));
vi.mock('../lib/runtime-evidence',async original=>({...(await original<typeof import('../lib/runtime-evidence')>()),databaseIdentity:m.database}));
import {GET,POST} from '../app/api/admin/opportunity-preview/route';
import {GET as workerGET} from '../app/api/admin/worker-evidence/route';
import {ProspectiveBlockedError} from '../lib/prospective-boundary';
const id='11111111-1111-4111-8111-111111111111';
const req=(body:unknown)=>new Request('https://fixture.example.test/api/admin/opportunity-preview',{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}});
beforeEach(()=>{vi.resetAllMocks();m.auth.mockResolvedValue({id:'synthetic-admin'});m.status.mockResolvedValue({id,state:'prepared'});});
it.each([401,404,503])('does no work when the shared admin guard returns %s',async status=>{
  m.auth.mockResolvedValue(new Response('Denied',{status}));
  expect((await POST(req({action:'execute',id}))).status).toBe(status);
  expect((await GET(new Request('https://fixture.example.test/?id='+id))).status).toBe(status);
  expect((await workerGET()).status).toBe(status);
  expect(m.execute).not.toHaveBeenCalled();expect(m.query).not.toHaveBeenCalled();expect(m.status).not.toHaveBeenCalled();
});
it('dry-run supplies zero-spend defaults and invokes no mutation/execution action',async()=>{
  m.dry.mockResolvedValue({sends:0});
  const response=await POST(req({action:'dry-run',input:{orgId:id,opportunityId:id,idempotencyKey:'fixture',model:'gpt-4.1'}}));
  expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(m.dry).toHaveBeenCalledWith(expect.objectContaining({approvedUsd:'0',maxRequests:0,approvalReference:''}));
  expect(m.prepare).not.toHaveBeenCalled();expect(m.activate).not.toHaveBeenCalled();expect(m.execute).not.toHaveBeenCalled();
});
it('rejects caller-owned execution tokens and malformed approval fields',async()=>{
  expect((await POST(req({action:'execute',id,owner:'forged'}))).status).toBe(400);
  expect((await POST(req({action:'prepare',input:{orgId:id,opportunityId:id,idempotencyKey:'fixture',model:'gpt-4.1',approvedUsd:-1}}))).status).toBe(400);
  expect(m.execute).not.toHaveBeenCalled();expect(m.prepare).not.toHaveBeenCalled();
});
it('returns a bounded refusal and does not expose raw failure details',async()=>{
  m.execute.mockRejectedValueOnce(new ProspectiveBlockedError('Synthetic missing approval'));
  const held=await POST(req({action:'execute',id}));expect(held.status).toBe(409);expect((await held.json()).error).toContain('missing approval');
  m.execute.mockRejectedValueOnce(Error('synthetic-private-secret'));
  const unknown=await POST(req({action:'execute',id}));expect(unknown.status).toBe(503);expect(await unknown.text()).not.toContain('synthetic-private-secret');
});
it('worker evidence exposes neither heartbeat detail nor raw database/provider data',async()=>{
  m.query.mockResolvedValue({instance_id:'fixture-worker',phase:'ready',booted_at:'2026-10-12T05:00:00Z',updated_at:'2026-10-12T05:01:00Z',detail:'synthetic-secret',runtime_evidence:{secret:'synthetic-secret'}});
  m.database.mockResolvedValue({fingerprint:'a'.repeat(64),isolatedDevelopment:true});
  const response=await workerGET();expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  const body=await response.json();expect(body.heartbeat.instanceId).toBe('fixture-worker');expect(JSON.stringify(body)).not.toContain('synthetic-secret');expect(body.limitations).toContain('not a verified cluster');
});
