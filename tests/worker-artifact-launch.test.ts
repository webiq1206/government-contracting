import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
it('starts the named artifact exactly once and refuses changed bytes before import',()=>{
  const dir=mkdtempSync(join(tmpdir(),'brostco-artifact-fixture-'));
  try {
    const id='11111111-1111-4111-8111-111111111111',workerFile=`worker-${id}.mjs`;
    const body="console.log('synthetic-worker-artifact-started')";
    writeFileSync(join(dir,workerFile),body);
    writeFileSync(join(dir,'runtime-build.json'),JSON.stringify({buildId:id,workerFile,workerSha256:createHash('sha256').update(body).digest('hex')}));
    const run=()=>spawnSync(process.execPath,[resolve('scripts/start-built-worker.mjs')],{encoding:'utf8',env:{PATH:process.env.PATH,BROSTCO_BUILD_DIR:dir}});
    const ok=run();expect(ok.status).toBe(0);expect(ok.stdout.trim()).toBe('synthetic-worker-artifact-started');
    writeFileSync(join(dir,workerFile),body+';console.log("changed")');
    const tampered=run();expect(tampered.status).not.toBe(0);expect(tampered.stdout).toBe('');expect(tampered.stderr).toContain('Refusing to start changed code');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
