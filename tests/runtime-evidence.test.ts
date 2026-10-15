import {expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('../lib/db',()=>({queryOne:m.query}));
import {parseBuildEvidence,databaseIdentity,safeWorkerEvidence} from '../lib/runtime-evidence';
const stamp={schema:1,verified:true,sourceCommit:'a'.repeat(40),sourceTree:'b'.repeat(40),buildId:'11111111-1111-4111-8111-111111111111',builtAt:'2026-10-12T05:00:00.000Z'};
it('requires a verified build stamp and drops fields outside the public evidence schema',()=>{
  expect(parseBuildEvidence(undefined)).toBeNull();expect(parseBuildEvidence('{')).toBeNull();
  expect(parseBuildEvidence(JSON.stringify({...stamp,verified:false}))).toBeNull();
  expect(parseBuildEvidence(JSON.stringify({...stamp,sourceCommit:'guessed'}))).toBeNull();
  expect(parseBuildEvidence(JSON.stringify({...stamp,secret:'synthetic-private'}))).not.toHaveProperty('secret');
});
it('fingerprints the actual database response and never returns database name or server address',async()=>{
  m.query.mockResolvedValue({database_name:'synthetic_db',server_address:'127.0.0.1',server_port:56435});
  const one=await databaseIdentity();expect(one?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(one)).not.toContain('synthetic_db');expect(JSON.stringify(one)).not.toContain('127.0.0.1');
  expect(await databaseIdentity()).toEqual(one);
  m.query.mockResolvedValue({database_name:'other_fixture',server_address:'127.0.0.1',server_port:56435});
  expect((await databaseIdentity())?.fingerprint).not.toBe(one?.fingerprint);
});
it('omits raw worker detail and arbitrary stored metadata',()=>{
  const result=safeWorkerEvidence({instance_id:'fixture-worker',phase:'ready',booted_at:'fixture-boot',updated_at:'fixture-observation',detail:'synthetic-private',
    runtime_evidence:{build:stamp,workerSourceRevision:'a'.repeat(40),boundaryVersion:'prospective-v1',raw:'synthetic-private',database:{fingerprint:'c'.repeat(64),isolatedDevelopment:true,password:'synthetic-private'}}});
  expect(result?.build?.sourceTree).toBe('b'.repeat(40));expect(JSON.stringify(result)).not.toContain('synthetic-private');
  expect(safeWorkerEvidence(null)).toBeNull();
});

it.each(['dirty','unavailable'])('retains source-input evidence when Git is %s without inventing provenance',gitEvidence=>{
  const unverified={...stamp,schema:2,verified:false,gitEvidence,sourceCommit:null,sourceTree:null,
    sourceInputScope:'brostco-source-inputs-v1',sourceInputSha256:'d'.repeat(64),sourceInputFiles:123,
    dependencyLockSha256:'e'.repeat(64),privateEnvironment:'synthetic-private'};
  const parsed=parseBuildEvidence(JSON.stringify(unverified));
  expect(parsed).toMatchObject({schema:2,verified:false,gitEvidence,sourceCommit:null,sourceTree:null,sourceInputSha256:'d'.repeat(64)});
  expect(JSON.stringify(parsed)).not.toContain('synthetic-private');
  expect(safeWorkerEvidence({runtime_evidence:{build:parsed}})?.build).toEqual(parsed);
  expect(parseBuildEvidence(JSON.stringify({...unverified,sourceCommit:'a'.repeat(40)}))).toBeNull();
  expect(parseBuildEvidence(JSON.stringify({...unverified,gitEvidence:'verified'}))).toBeNull();
  expect(parseBuildEvidence(JSON.stringify({...unverified,sourceInputSha256:null}))).toBeNull();
  expect(parseBuildEvidence(JSON.stringify({...unverified,sourceInputScope:'unknown'}))).toBeNull();
});
it('preserves verified Git evidence and supports old normalized heartbeat stamps without promoting an explicit rejection',()=>{
  const v2={...stamp,schema:2,gitEvidence:'verified',sourceInputScope:'brostco-source-inputs-v1',sourceInputSha256:'d'.repeat(64),sourceInputFiles:123,dependencyLockSha256:'e'.repeat(64)};
  expect(parseBuildEvidence(JSON.stringify(v2))).toMatchObject({verified:true,sourceCommit:stamp.sourceCommit});
  const {schema,verified,...legacy}=stamp;
  expect(safeWorkerEvidence({runtime_evidence:{build:legacy}})?.build?.sourceTree).toBe(stamp.sourceTree);
  expect(safeWorkerEvidence({runtime_evidence:{build:{...stamp,verified:false}}})?.build).toBeNull();
});
