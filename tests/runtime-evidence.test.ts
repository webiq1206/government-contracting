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
