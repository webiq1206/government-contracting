/** Independent boundary contract tests. All records and completion transports
 * are synthetic. PGlite serializes transactions; the optional loopback PG
 * adapter exercises the actual advisory lock across separate connections.
 * This suite does not claim production rollout, provider, or hook coverage. */
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const fixture = vi.hoisted(() => ({
  db: null as any, realPg: false, credential: 'synthetic-preview-key',
  complete: vi.fn(), recover: vi.fn(), transport: vi.fn(), network: vi.fn(),
  reservation: '3', lostCompletionAck: false,
}));
vi.mock('../lib/db', () => ({
  query: async (sql: string, args: unknown[] = []) => (await fixture.db.query(sql, args)).rows,
  queryOne: async (sql: string, args: unknown[] = []) => (await fixture.db.query(sql, args)).rows[0] ?? null,
  transaction: async (fn: any) => {
    let committedCompletion = false;
    const value = await fixture.db.transaction((tx: any) => fn({ query: async (sql: string, args: unknown[] = []) => {
      if (!fixture.realPg && sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      const result = await tx.query(sql, args);
      if (sql.includes("set state='complete'")) committedCompletion = true;
      return result;
    } }));
    if (committedCompletion && fixture.lostCompletionAck) {
      fixture.lostCompletionAck = false;
      throw new Error('Synthetic lost commit acknowledgement');
    }
    return value;
  },
}));
vi.mock('../lib/integration-keys', () => ({ orgApiKey: async () => fixture.credential }));
vi.mock('../lib/api-usage/credentials', () => ({ platformApiValue: () => { throw new Error('No credential lookup permitted'); } }));
vi.mock('../lib/integration-settings', () => ({ decryptSecret: () => { throw new Error('No secret decryption permitted'); } }));
vi.mock('../lib/api-usage/ledger', async original => ({
  ...await original<any>(),
  requestIdentity: async (envKey: string, value: string, orgId: string) => ({
    orgId, envKey, value, source: 'platform', accepted: false,
    configurationReference: { credentialStore: 'platform_settings', settingsOrgId: orgId, credentialSetting: envKey },
  }),
}));
vi.mock('../lib/ai/claude', () => ({
  planRoute: async (opts: { model: string }) => ({ primary: {
    model: opts.model, provider: 'OpenAI', envKey: 'OPENAI_API_KEY', complex: false,
  }, fallback: null }),
  complete: (...args: unknown[]) => fixture.complete(...args),
  probeProviderRecovery: (...args: unknown[]) => fixture.recover(...args),
}));
import {
  activatePreview, dryRunPreview, executePreview, guardProspectiveProvider,
  lockProspectiveAdmission, preparePreview, previewStatus, releasePreview,
  withProspectiveDispatch,
} from '../lib/prospective-boundary';
import { beginUsage, finishUsage, metered, requestIdentity, settleAbandonedUsage } from '../lib/api-usage/ledger';
import { transaction } from '../lib/db';
import { withApiUsageContext } from '../lib/api-usage/context';

const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherOrg = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const opportunity = '11111111-1111-4111-8111-111111111111';
const rollout = 'synthetic-reviewed-rollout-only';
const input = (extra = {}) => ({ orgId: org, opportunityId: opportunity,
  idempotencyKey: 'independent-fixture', model: 'gpt-4.1', approvedUsd: '3',
  maxRequests: 1, approvalReference: 'Synthetic test approval, never live authority', ...extra });
const completion = { text: 'Synthetic unsent preview', model: 'gpt-4.1',
  stopReason: 'end_turn', usage: { input_tokens: 20, output_tokens: 10 } };
let cleanup = async () => {};
let oldRows: unknown;
const historical = async () => ({
  holds: (await fixture.db.query("select * from api_usage_events where feature='historical' order by id")).rows,
  receipts: (await fixture.db.query('select * from ai_work_receipts order by id')).rows,
});
const heldFence = async () => (await fixture.db.query('select preview_id from prospective_fence where released_at is null')).rows;
const prepared = async (extra = {}) => preparePreview(input(extra), 'fixture-admin');
const active = async (extra = {}) => {
  const value = await prepared(extra);
  await activatePreview(value.id, 'fixture-admin', rollout);
  return value;
};

/** A synthetic provider adapter calls the real boundary hooks under the same
 * transaction protocol as production. No real SDK, credential, or network. */
async function syntheticAttempt(recovery: boolean) {
  const identity = await requestIdentity('OPENAI_API_KEY', fixture.credential, org);
  await transaction(async client => {
    await lockProspectiveAdmission(client);
    await guardProspectiveProvider(client, identity, 'OpenAI', recovery);
  });
  const usageId = await beginUsage(identity,'OpenAI','gpt-4.1','preview');
  const result = await fixture.transport(recovery);
  await finishUsage(usageId,{units:{input_tokens:20,output_tokens:10},requestId:'synthetic-preview-response'});
  return result;
}

beforeAll(async () => {
  if (process.env.ALLOW_TESTS_AGAINST_DATABASE_URL === '1') {
    const dev = process.env.USE_REPLIT_DEV_DB === 'true';
    const url = dev ? null : new URL(process.env.DATABASE_URL ?? '');
    const host = dev ? process.env.PGHOST : url?.hostname;
    if (!host || !new Set(['localhost', '127.0.0.1', '[::1]']).has(host)) throw new Error('Only disposable loopback PostgreSQL is allowed');
    const connection = dev ? { host, port: Number(process.env.PGPORT ?? 5432), database: process.env.PGDATABASE,
      user: process.env.PGUSER, password: process.env.PGPASSWORD } : { connectionString: url!.href };
    const { Pool, types } = await import('pg');
    const originalParser = types.getTypeParser(1700);
    types.setTypeParser(1700, value => Number(value));
    const schema = 'preview_test_' + randomUUID().replaceAll('-', '');
    const admin = new Pool(connection);
    await admin.query(`create schema ${schema}`);
    // Never fall through to migrated public tables when testing a missing
    // fixture relation. PostgreSQL searches pg_catalog implicitly.
    const pool = new Pool({ ...connection, options: `-c search_path=${schema}` });
    fixture.realPg = true;
    fixture.db = { query: (sql: string, args?: unknown[]) => pool.query(sql, args), exec: (sql: string) => pool.query(sql),
      transaction: async (fn: any) => {
        const client = await pool.connect();
        try { await client.query('begin'); const result = await fn(client); await client.query('commit'); return result; }
        catch (error) { await client.query('rollback'); throw error; }
        finally { client.release(); }
      } };
    cleanup = async () => { await pool.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end(); types.setTypeParser(1700, originalParser); };
  } else {
    fixture.db = new PGlite({ parsers: { 1700: value => Number(value) } });
    cleanup = () => fixture.db.close();
  }
  await fixture.db.exec(`create table organizations(id uuid primary key);
    create table opportunities(id uuid primary key,org_id uuid references organizations(id),pursuit_version integer,
      pursuit_state text,status text,stage text,title text,description text,naics_code text,deadline timestamptz,agency text);
    create table platform_key_usage(org_id uuid,env_key text,calls integer,last_used timestamptz,primary key(org_id,env_key));
    create table ai_provider_facts(pending_attempt uuid);
    create table job_runs(status text);
    create table ai_work_receipts(id uuid primary key,state text,owner uuid,result jsonb);
    insert into organizations values('${org}'),('${otherOrg}');`);
  for (const file of ['112_api_usage_ledger.sql','113_api_spending_controls.sql','116_api_safe_defaults.sql',
    '118_openai_provider.sql','131_provider_diagnostics.sql','132_prospective_boundary.sql'])
    await fixture.db.exec(readFileSync('db/migrations/'+file, 'utf8'));
}, 30000);
afterAll(async () => cleanup());
beforeEach(async () => {
  vi.stubEnv('BROSTCO_PREVIEW_ROLLOUT_REFERENCE', rollout);
  await fixture.db.exec('truncate prospective_attempts,prospective_fence,prospective_previews,prospective_dispatch_claims,api_usage_events,ai_provider_facts,job_runs,ai_work_receipts,opportunities,api_usage_rates,platform_key_usage cascade');
  await fixture.db.query(`insert into opportunities values($1,$2,1,'active','open','new','Synthetic opportunity',
    'A public-safe synthetic notice.','236220','2100-01-01T00:00:00Z','Synthetic agency')`, [opportunity,org]);
  await fixture.db.exec(`insert into api_usage_events(id,outcome,feature,reserved_cost,started_at,provider,service,credential_source,credential_fingerprint)
    select gen_random_uuid(),'failed','historical',3,'2020-01-01','OpenAI','gpt-4.1','platform','synthetic-old' from generate_series(1,38);
    insert into ai_work_receipts select gen_random_uuid(),'pending',gen_random_uuid(),null from generate_series(1,3);
    insert into api_usage_rates(provider,service,max_request_cost,rates,evidence) values('OpenAI','gpt-4.1',3,'{"input_tokens":"2","output_tokens":"8","cached_input_tokens":"0.5"}','Synthetic test rate');`);
  fixture.credential = 'synthetic-preview-key'; fixture.reservation = '3'; fixture.lostCompletionAck = false;
  fixture.complete.mockReset().mockImplementation(() => syntheticAttempt(false));
  fixture.recover.mockReset().mockImplementation(() => syntheticAttempt(true));
  fixture.transport.mockReset().mockResolvedValue(completion);
  fixture.network.mockReset().mockImplementation(() => { throw new Error('No network is permitted'); });
  vi.stubGlobal('fetch', fixture.network);
  oldRows = await historical();
});
afterEach(async () => {
  try { expect(fixture.network).not.toHaveBeenCalled(); expect(await historical()).toEqual(oldRows); }
  finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});

it('dry-run with missing approval writes no operation, fence, usage or receipt', async () => {
  const result = await dryRunPreview({orgId:org,opportunityId:opportunity,idempotencyKey:'no-approval',model:'gpt-4.1'});
  expect(result.spendingApproved).toBe(false);
  expect((await fixture.db.query('select * from prospective_previews')).rows).toEqual([]);
  expect(await heldFence()).toEqual([]);
  expect(fixture.complete).not.toHaveBeenCalled();
});
it('an unset rollout gate cannot activate even approved prepared work', async () => {
  const p = await prepared(); vi.stubEnv('BROSTCO_PREVIEW_ROLLOUT_REFERENCE','');
  await expect(activatePreview(p.id,'fixture-admin',rollout)).rejects.toThrow('rollout');
  expect(await heldFence()).toEqual([]);
});
it.each([{approvedUsd:'0'}, {maxRequests:0}, {approvalReference:''}])('missing spending authority cannot dispatch: %j', async extra => {
  const p = await prepared(extra);
  await expect(activatePreview(p.id,'fixture-admin',rollout)).rejects.toThrow('approval');
  expect(fixture.transport).not.toHaveBeenCalled();
  expect(await previewStatus(p.id)).toMatchObject({state:'prepared',requests:0,reserved_usd:'0.000000000000'});
  expect(await heldFence()).toEqual([]);
});
it('same prepared input is idempotent and neither a new key nor changed prompt replaces its scope', async () => {
  const p = await prepared(); expect(await prepared()).toEqual(p);
  await expect(prepared({idempotencyKey:'new-key'})).rejects.toThrow('different prepared work');
  await fixture.db.query("update opportunities set description='changed' where id=$1",[opportunity]);
  await expect(prepared()).rejects.toThrow('different prepared work');
  await expect(activatePreview(p.id,'fixture-admin',rollout)).rejects.toThrow('changed');
});
it('a different tenant cannot adopt the opportunity', async () => {
  await expect(prepared({orgId:otherOrg})).rejects.toThrow('named organization');
  expect(fixture.transport).not.toHaveBeenCalled();
});
it.each(['usage','provider','job','dispatch'])('old unresolved %s ownership blocks activation without aging out', async kind => {
  const p = await prepared();
  if(kind==='usage') await fixture.db.exec("insert into api_usage_events(id,outcome,started_at,provider,service,feature,credential_source,credential_fingerprint) values(gen_random_uuid(),'pending','2000-01-01','OpenAI','gpt-4.1','old pending','platform','synthetic')");
  if(kind==='provider') await fixture.db.exec('insert into ai_provider_facts values(gen_random_uuid())');
  if(kind==='job') await fixture.db.exec("insert into job_runs values('running')");
  if(kind==='dispatch') await fixture.db.exec("insert into prospective_dispatch_claims(id,kind,started_at) values(gen_random_uuid(),'mail','2000-01-01')");
  await expect(activatePreview(p.id,'fixture-admin',rollout)).rejects.toThrow('unresolved dispatch');
  expect(await heldFence()).toEqual([]);
});
it('already-admitted dispatch prevents activation until its callback completes', async () => {
  const p = await prepared(); let release!:()=>void; let started!:()=>void;
  const gate = new Promise<void>(resolve=>{release=resolve;});
  const entered = new Promise<void>(resolve=>{started=resolve;});
  const dispatch = withProspectiveDispatch('mail',async()=>{started();await gate;return 'certain';});
  await entered;
  await expect(activatePreview(p.id,'fixture-admin',rollout)).rejects.toThrow('unresolved dispatch');
  release(); await dispatch;
  await activatePreview(p.id,'fixture-admin',rollout);
  expect(await heldFence()).toEqual([{preview_id:p.id}]);
});
it('simultaneous activation and dispatch never both own the execution window', async () => {
  const p = await prepared(); let release!:()=>void;
  const gate = new Promise<void>(resolve=>{release=resolve;});
  const callback = vi.fn(async()=>{await gate;return 'certain';});
  const activation = activatePreview(p.id,'fixture-admin',rollout).then(()=>true,()=>false).finally(()=>release());
  const dispatched = withProspectiveDispatch('agent',callback).then(()=>true,()=>false);
  const [activated,ran] = await Promise.all([activation,dispatched]);
  expect(Number(activated)+Number(ran)).toBe(1);
  expect(callback).toHaveBeenCalledTimes(ran?1:0);
});
it('an uncertain mail result retains its claim and blocks later activation', async () => {
  const p = await prepared();
  await withProspectiveDispatch('mail',async()=>({outcome:'unknown'}), value=>value.outcome==='accepted');
  await expect(activatePreview(p.id,'fixture-admin',rollout)).rejects.toThrow('unresolved dispatch');
});
it('aging a direct non-AI metered request cannot hide its still-running callback', async () => {
  const p = await prepared(); let release!:()=>void; let entered!:()=>void;
  const started = new Promise<void>(resolve=>{entered=resolve;});
  const gate = new Promise<void>(resolve=>{release=resolve;});
  const identity = await requestIdentity('TWILIO_AUTH_TOKEN','synthetic-sms-token',org);
  const running = metered(identity,'Twilio','SMS','synthetic direct API',async()=>{
    entered(); await gate; return {id:'synthetic-message'};
  },value=>({requestId:value.id,units:{requests:1}}));
  const result = running.then(value=>({value}),error=>{entered();return {error};});
  await started;
  try {
    const event = (await fixture.db.query("select id from api_usage_events where feature='synthetic direct API'")).rows[0];
    expect(event).toBeTruthy();
    await fixture.db.query("update api_usage_events set started_at='2000-01-01' where id=$1",[event.id]);
    expect(await settleAbandonedUsage()).toBe(1);
    expect((await fixture.db.query('select outcome from api_usage_events where id=$1',[event.id])).rows[0]).toEqual({outcome:'failed'});
    expect((await fixture.db.query("select kind,finished_at from prospective_dispatch_claims where id=$1",[event.id])).rows[0]).toEqual({kind:'api',finished_at:null});
    await expect(activatePreview(p.id,'fixture-admin',rollout)).rejects.toThrow('unresolved dispatch');
  } finally { release(); }
  expect(await result).toEqual({value:{id:'synthetic-message'}});
  await activatePreview(p.id,'fixture-admin',rollout);
  expect(await heldFence()).toEqual([{preview_id:p.id}]);
});
it.each([408,500,529])('an ambiguous direct API HTTP %s retains its non-aging dispatch claim',async status=>{
  const p = await prepared();
  const identity = await requestIdentity('TWILIO_AUTH_TOKEN','synthetic-sms-token',org);
  await expect(metered(identity,'Twilio','SMS','synthetic uncertain API',async()=>{
    throw Object.assign(new Error('Synthetic response'),{status});
  })).rejects.toThrow('Synthetic response');
  expect((await fixture.db.query("select finished_at from prospective_dispatch_claims where kind='api'")).rows).toEqual([{finished_at:null}]);
  await expect(activatePreview(p.id,'fixture-admin',rollout)).rejects.toThrow('unresolved dispatch');
});
it('an explicit direct API refusal closes its claim without releasing historical holds',async()=>{
  const p = await prepared();
  const identity = await requestIdentity('TWILIO_AUTH_TOKEN','synthetic-sms-token',org);
  await expect(metered(identity,'Twilio','SMS','synthetic refused API',async()=>{
    throw Object.assign(new Error('Synthetic refusal'),{status:429});
  })).rejects.toThrow('Synthetic refusal');
  expect((await fixture.db.query("select finished_at from prospective_dispatch_claims where kind='api'")).rows[0].finished_at).not.toBeNull();
  await activatePreview(p.id,'fixture-admin',rollout);
});
it('lost schema fails closed before any ordinary callback', async () => {
  const callback = vi.fn();
  await fixture.db.exec('alter table prospective_fence rename to temporarily_missing_fence');
  try { await expect(withProspectiveDispatch('enqueue',callback)).rejects.toThrow(); expect(callback).not.toHaveBeenCalled(); }
  finally { await fixture.db.exec('alter table temporarily_missing_fence rename to prospective_fence'); }
});
it.each(['agent','enqueue','mail'] as const)('active fence rejects ordinary %s and forged usage context', async kind => {
  const p = await active(); const callback = vi.fn();
  await expect(withApiUsageContext({workflow:p.id,relatedId:opportunity,workKey:p.id},()=>withProspectiveDispatch(kind,callback))).rejects.toThrow();
  expect(callback).not.toHaveBeenCalled();
});
it('two execute callers produce one completion and a terminal retry reuses it', async () => {
  const p = await active();
  const results = await Promise.allSettled([executePreview(p.id),executePreview(p.id)]);
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
  expect(fixture.transport).toHaveBeenCalledOnce();
  expect(await executePreview(p.id)).toEqual(completion);
  expect(fixture.transport).toHaveBeenCalledOnce();
  expect(await previewStatus(p.id)).toMatchObject({state:'complete',requests:1,reserved_usd:'3.000000000000',platform_hold:true});
});
it('recovery and analysis share one immutable allowance and different durable step receipts', async () => {
  const p = await active({recovery:true,approvedUsd:'6',maxRequests:2});
  await executePreview(p.id);
  expect(fixture.transport.mock.calls).toEqual([[true],[false]]);
  expect((await fixture.db.query('select step from prospective_attempts order by step')).rows).toEqual([{step:'analysis'},{step:'recovery'}]);
  expect(await previewStatus(p.id)).toMatchObject({requests:2,reserved_usd:'6.000000000000',platform_hold:true});
});
it('successful recovery cannot release unrelated work before analysis or afterward', async () => {
  const p = await active({recovery:true,approvedUsd:'6',maxRequests:2});
  fixture.transport.mockImplementation(async(recovery:boolean)=>{
    if(recovery) await expect(withProspectiveDispatch('agent',async()=>null)).rejects.toThrow();
    return completion;
  });
  await executePreview(p.id);
  await expect(withProspectiveDispatch('agent',async()=>null)).rejects.toThrow();
});
it('exact decimal cap shortfall refuses activation before taking a platform hold', async () => {
  const p = await prepared({approvedUsd:'2.999999999999'});
  await expect(activatePreview(p.id,'fixture-admin',rollout)).rejects.toThrow('approval');
  expect(fixture.transport).not.toHaveBeenCalled();
  expect((await fixture.db.query('select * from api_usage_events where workflow=$1',[p.id])).rows).toEqual([]);
  expect(await previewStatus(p.id)).toMatchObject({state:'prepared',requests:0,reserved_usd:'0.000000000000',platform_hold:false});
});
it('duplicate provider dispatch for the same step rolls back its usage and reserve', async () => {
  const p = await active({approvedUsd:'6',maxRequests:2});
  fixture.complete.mockImplementation(async()=>{await syntheticAttempt(false);return syntheticAttempt(false);});
  await expect(executePreview(p.id)).rejects.toThrow();
  expect(fixture.transport).toHaveBeenCalledOnce();
  expect(await previewStatus(p.id)).toMatchObject({state:'held',requests:1,reserved_usd:'3.000000000000'});
  expect((await fixture.db.query('select * from api_usage_events where workflow=$1',[p.id])).rows).toHaveLength(1);
});
it('timeout preserves the owner, usage, allowance and fence and cannot replay or release', async () => {
  const p = await active(); fixture.transport.mockRejectedValue(new Error('Synthetic timeout'));
  await expect(executePreview(p.id)).rejects.toThrow('timeout');
  await expect(executePreview(p.id)).rejects.toThrow('cannot be replayed');
  await expect(releasePreview(p.id,'fixture-admin',rollout)).rejects.toThrow('uncertain');
  expect(fixture.transport).toHaveBeenCalledOnce();
  expect(await previewStatus(p.id)).toMatchObject({state:'held',requests:1,reserved_usd:'3.000000000000',platform_hold:true});
});
it('lost terminal commit acknowledgement preserves completion and prevents another attempt', async () => {
  const p = await active(); fixture.lostCompletionAck=true;
  await expect(executePreview(p.id)).rejects.toThrow('lost commit acknowledgement');
  expect(await previewStatus(p.id)).toMatchObject({state:'complete',platform_hold:true});
  expect(await executePreview(p.id)).toEqual(completion);
  expect(fixture.transport).toHaveBeenCalledOnce();
});
it('input edited during completion prevents publishing the preview result', async () => {
  const p = await active();
  fixture.transport.mockImplementation(async()=>{await fixture.db.query("update opportunities set description='amended after dispatch' where id=$1",[opportunity]);return completion;});
  await expect(executePreview(p.id)).rejects.toThrow('changed');
  expect(await previewStatus(p.id)).toMatchObject({state:'held',result:null,platform_hold:true});
});
it('credential changes after preparation prevent dispatch', async () => {
  const p = await active(); fixture.credential='synthetic-rotated-key';
  await expect(executePreview(p.id)).rejects.toThrow('configuration changed');
  expect(fixture.transport).not.toHaveBeenCalled();
});
it('owner changes during a paused transport prevent a stale result commit or replay', async () => {
  const p = await active(); let release!:(value:typeof completion)=>void; let entered!:()=>void;
  const started = new Promise<void>(resolve=>{entered=resolve;});
  fixture.transport.mockImplementation(()=>{entered();return new Promise(resolve=>{release=resolve;});});
  const running = executePreview(p.id);
  // Attach a rejection observer immediately while the transport is paused.
  const result = running.then(value=>({value}),error=>({error}));
  await started;
  await expect(releasePreview(p.id,'fixture-admin',rollout)).rejects.toThrow('uncertain');
  await fixture.db.query('update prospective_previews set owner=$2 where id=$1',[p.id,randomUUID()]);
  release(completion);
  expect(await result).toHaveProperty('error');
  expect(await previewStatus(p.id)).toMatchObject({state:'running',result:null,platform_hold:true});
  await expect(executePreview(p.id)).rejects.toThrow('cannot be replayed');
  expect(fixture.transport).toHaveBeenCalledOnce();
});
it('an understated configured reservation cannot substitute for the bounded token cost', async () => {
  fixture.reservation='0.000000000001';
  await fixture.db.query('update api_usage_rates set max_request_cost=$1',[fixture.reservation]);
  const p = await prepared({approvedUsd:'0.000000000001'});
  await expect(activatePreview(p.id,'fixture-admin',rollout)).rejects.toThrow('bounded preview');
  expect(fixture.transport).not.toHaveBeenCalled();
  expect(await previewStatus(p.id)).toMatchObject({state:'prepared',requests:0,reserved_usd:'0.000000000000',platform_hold:false});
});
it('pricing edits invalidate prepared work before dispatch', async () => {
  const p = await active();
  await fixture.db.exec("update api_usage_rates set rates='{\"input_tokens\":\"3\",\"output_tokens\":\"8\"}'");
  await expect(executePreview(p.id)).rejects.toThrow('pricing changed');
  expect(fixture.transport).not.toHaveBeenCalled();
  expect(await previewStatus(p.id)).toMatchObject({state:'prepared',requests:0});
  await releasePreview(p.id,'fixture-admin',rollout);
  expect(await heldFence()).toEqual([]);
});
it('missing input pricing blocks a supposedly priced request', async () => {
  await fixture.db.exec("update api_usage_rates set rates='{\"output_tokens\":\"8\"}'");
  const p = await prepared();
  await expect(activatePreview(p.id,'fixture-admin',rollout)).rejects.toThrow('bounded price');
  expect(fixture.transport).not.toHaveBeenCalled();
});
it('recovery cannot begin when the approval covers only one of the two immutable steps',async()=>{
  const p = await prepared({recovery:true,maxRequests:2,approvedUsd:'3'});
  await expect(activatePreview(p.id,'fixture-admin',rollout)).rejects.toThrow('complete preview plan');
  expect(fixture.transport).not.toHaveBeenCalled();
  expect(await heldFence()).toEqual([]);
});
it('a reasoning model without a reviewed bound cannot prepare work', async () => {
  await expect(prepared({model:'unreviewed-reasoning-model'})).rejects.toThrow('bounded preview');
  expect(fixture.transport).not.toHaveBeenCalled();
});
it('expired notice cannot prepare paid prospective work', async () => {
  await fixture.db.query("update opportunities set deadline=clock_timestamp()-interval '1 second' where id=$1",[opportunity]);
  await expect(prepared()).rejects.toThrow();
  expect(fixture.transport).not.toHaveBeenCalled();
});
it('unknown deadline cannot prepare paid prospective work', async () => {
  await fixture.db.query('update opportunities set deadline=null where id=$1',[opportunity]);
  await expect(prepared()).rejects.toThrow();
  expect(fixture.transport).not.toHaveBeenCalled();
});
