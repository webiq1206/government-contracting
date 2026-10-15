import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { sourceInputEvidence, assertUnchangedSourceInputs } from './build-source-evidence.mjs';

function source() {
  try {
    const git = (...args) => execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
    return { commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),status:git('status','--porcelain') };
  } catch { return null; }
}
const before=source();
const verified=Boolean(before && !before.status);
const inputs=sourceInputEvidence();
const stamp={ schema:2,sourceCommit:verified?before.commit:null,sourceTree:verified?before.tree:null,
  buildId:randomUUID(),builtAt:new Date().toISOString(),verified,
  gitEvidence:verified?'verified':before?'dirty':'unavailable', ...inputs,
  dependencyLockSha256:createHash('sha256').update(readFileSync('package-lock.json')).digest('hex') };
const result=spawnSync(process.execPath,['node_modules/next/dist/bin/next','build'],{
  stdio:'inherit',env:{...process.env,BROSTCO_COMPILED_BUILD:JSON.stringify(stamp)},
});
if (result.status!==0) process.exit(result.status??1);
const after=source();
assertUnchangedSourceInputs(inputs);
if (verified && (!after || before.commit!==after.commit || before.tree!==after.tree || after.status)) {
  console.error('Source changed during the build; no verified runtime manifest was published.'); process.exit(1);
}
const directory=resolve(process.env.BROSTCO_BUILD_DIR||'.next');
mkdirSync(directory,{recursive:true});
const workerFile=`worker-${stamp.buildId}.mjs`;
await build({entryPoints:['worker/index.ts'],bundle:true,platform:'node',format:'esm',packages:'external',
  outfile:resolve(directory,workerFile),target:'node22',
  plugins:[{name:'next-node-subpaths',setup(build){
    // Node ESM requires the installed extension for Next's CJS subpaths.
    // Keep package-relative names, never build-machine absolute paths.
    build.onResolve({filter:/^next\/(headers|server|navigation)$/},args=>({path:args.path+'.js',external:true}));
  }}],
  banner:{js:"import {createRequire as runtimeCreateRequire} from 'node:module'; const require=runtimeCreateRequire(import.meta.url);"},
  define:{__BROSTCO_COMPILED_BUILD__:JSON.stringify(JSON.stringify(stamp)),
    __BROSTCO_WORKER_SOURCE_REVISION__:JSON.stringify(stamp.sourceCommit??''),
    __BROSTCO_WORKER_ARTIFACT__:JSON.stringify(workerFile)},
});
const finalSource=source();
assertUnchangedSourceInputs(inputs);
if (verified && (!finalSource || before.commit!==finalSource.commit || before.tree!==finalSource.tree || finalSource.status)) {
  console.error('Source changed during worker compilation; runtime publication refused.'); process.exit(1);
}
const workerSha256=createHash('sha256').update(readFileSync(resolve(directory,workerFile))).digest('hex');
writeFileSync(resolve(directory,'runtime-build.json'),JSON.stringify({...stamp,workerFile,workerSha256},null,2)+'\n');
