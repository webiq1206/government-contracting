import { createHash } from 'node:crypto';
import { queryOne } from './db';
import { config } from './config';
declare const __BROSTCO_COMPILED_BUILD__:string|undefined;
declare const __BROSTCO_WORKER_SOURCE_REVISION__:string|undefined;
declare const __BROSTCO_WORKER_ARTIFACT__:string|undefined;

export function parseBuildEvidence(raw:string|undefined) {
  try {
    const item=JSON.parse(raw??'');
    if (!item || ![1,2].includes(item.schema) || typeof item.buildId!=='string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item.buildId) ||
      typeof item.builtAt!=='string' || !Number.isFinite(Date.parse(item.builtAt))) return null;
    const validGit = item.verified===true && /^[0-9a-f]{40}$/.test(item.sourceCommit) && /^[0-9a-f]{40}$/.test(item.sourceTree);
    if (item.schema===1 && !validGit) return null;
    if (item.schema===2 && (
      !['verified','dirty','unavailable'].includes(item.gitEvidence) ||
      (item.gitEvidence==='verified' ? !validGit : item.verified!==false || item.sourceCommit!==null || item.sourceTree!==null) ||
      item.sourceInputScope!=='brostco-source-inputs-v1' || !/^[0-9a-f]{64}$/.test(item.sourceInputSha256) ||
      !Number.isSafeInteger(item.sourceInputFiles) || item.sourceInputFiles < 1 ||
      !/^[0-9a-f]{64}$/.test(item.dependencyLockSha256)
    )) return null;
    return { schema:item.schema as 1|2, verified:validGit,
      gitEvidence:(validGit?'verified':item.gitEvidence) as 'verified'|'dirty'|'unavailable',
      sourceCommit:validGit?item.sourceCommit as string:null,sourceTree:validGit?item.sourceTree as string:null,
      buildId:item.buildId as string,builtAt:item.builtAt as string,
      sourceInputScope:item.schema===2?'brostco-source-inputs-v1':null,
      sourceInputSha256:item.schema===2?item.sourceInputSha256 as string:null,
      sourceInputFiles:item.schema===2?item.sourceInputFiles as number:null,
      dependencyLockSha256:/^[0-9a-f]{64}$/.test(item.dependencyLockSha256??'')?item.dependencyLockSha256 as string:null };
  } catch { return null; }
}
/** Whether the build contained everything already merged to GitHub main. */
export interface MainFreshness {
  upToDate: boolean | null;
  missingCommits: number | null;
  originMain: string | null;
  fetched: boolean;
  checkedAt: string;
}

export function parseMainFreshness(raw:string|undefined):MainFreshness|null {
  try {
    const m=JSON.parse(raw??'')?.mainEvidence;
    if (!m || typeof m!=='object' || typeof m.checkedAt!=='string' || !Number.isFinite(Date.parse(m.checkedAt))) return null;
    const missing=Number.isSafeInteger(m.missingCommits) && m.missingCommits>=0 ? m.missingCommits as number : null;
    return { upToDate: typeof m.upToDate==='boolean' && missing!==null ? m.upToDate : null, missingCommits: missing,
      originMain: /^[0-9a-f]{40}$/.test(m.originMain??'') ? m.originMain as string : null,
      fetched: m.fetched===true, checkedAt: m.checkedAt };
  } catch { return null; }
}

// Next replaces this reference with the literal supplied to the build. The
// bundled worker embeds the same literal; source workers have no build proof.
export const runtimeBuild = parseBuildEvidence(typeof __BROSTCO_COMPILED_BUILD__==='string'?__BROSTCO_COMPILED_BUILD__:undefined);
export const buildMainFreshness = parseMainFreshness(typeof __BROSTCO_COMPILED_BUILD__==='string'?__BROSTCO_COMPILED_BUILD__:undefined);
export const workerSourceRevision = typeof __BROSTCO_WORKER_SOURCE_REVISION__==='string' && /^[0-9a-f]{40}$/.test(__BROSTCO_WORKER_SOURCE_REVISION__)
  ? __BROSTCO_WORKER_SOURCE_REVISION__ : null;
export const workerArtifact=typeof __BROSTCO_WORKER_ARTIFACT__==='string' && __BROSTCO_WORKER_ARTIFACT__ ? __BROSTCO_WORKER_ARTIFACT__ : null;
export const workerArtifactSha256=workerArtifact && /^[0-9a-f]{64}$/.test(process.env.BROSTCO_WORKER_ARTIFACT_SHA256??'')
  ? process.env.BROSTCO_WORKER_ARTIFACT_SHA256! : null;
export const BOUNDARY_VERSION='prospective-v1';

export function safeWorkerEvidence(row:Record<string,any>|null) {
  if (!row) return null;
  const evidence=row.runtime_evidence??{};
  const build=evidence.build;
  // Older workers stored a normalized schema-1 stamp without its discriminator.
  // Never promote a new unverified/dirty stamp into verified Git provenance.
  const storedBuild=build && build.schema===undefined && build.verified===undefined && build.gitEvidence===undefined
    ? {...build,schema:1,verified:true} : build;
  return { instanceId:typeof row.instance_id==='string'?row.instance_id.slice(0,80):null,
    phase:typeof row.phase==='string'?row.phase.slice(0,80):null,
    bootedAt:row.booted_at,updatedAt:row.updated_at,
    build:storedBuild ? parseBuildEvidence(JSON.stringify(storedBuild)) : null,
    workerSourceRevision:/^[0-9a-f]{40}$/.test(evidence.workerSourceRevision??'')?evidence.workerSourceRevision:null,
    workerArtifact:/^worker-[0-9a-f-]{36}\.mjs$/.test(evidence.workerArtifact??'')?evidence.workerArtifact:null,
    workerArtifactSha256:/^[0-9a-f]{64}$/.test(evidence.workerArtifactSha256??'')?evidence.workerArtifactSha256:null,
    boundaryVersion:evidence.boundaryVersion===BOUNDARY_VERSION?BOUNDARY_VERSION:null,
    database:/^[0-9a-f]{64}$/.test(evidence.database?.fingerprint??'') ? {
      fingerprint:evidence.database.fingerprint,isolatedDevelopment:evidence.database.isolatedDevelopment===true } : null };
}

export async function databaseIdentity() {
  const row=await queryOne<{database_name:string;server_address:string;server_port:number}>(
    'select current_database() as database_name,inet_server_addr()::text as server_address,inet_server_port() as server_port');
  if (!row?.database_name || !row.server_address || !row.server_port) return null;
  return { fingerprint:createHash('sha256').update(JSON.stringify([row.database_name,row.server_address,row.server_port])).digest('hex'),
    isolatedDevelopment:config.database.isIsolatedDev };
}
