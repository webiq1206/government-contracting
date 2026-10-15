import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SOURCE_INPUT_ROOTS, sourceInputEvidence, assertUnchangedSourceInputs } from '../scripts/build-source-evidence.mjs';
let root:string;
beforeEach(()=>{
  root=mkdtempSync(join(tmpdir(),'brostco-build-inputs-'));
  for(const name of SOURCE_INPUT_ROOTS) {
    if(name.includes('.')) writeFileSync(join(root,name),'synthetic source');
    else {mkdirSync(join(root,name));writeFileSync(join(root,name,'fixture.txt'),'synthetic source');}
  }
});
afterEach(()=>rmSync(root,{recursive:true,force:true}));
it('is reproducible without Git and contains no paths, source text or environment secrets',()=>{
  const evidence=sourceInputEvidence(root);
  expect(evidence).toEqual(sourceInputEvidence(root));
  expect(evidence.sourceInputSha256).toMatch(/^[0-9a-f]{64}$/);
  writeFileSync(join(root,'.env'),'SYNTHETIC_PRIVATE_SECRET=value');
  expect(sourceInputEvidence(root)).toEqual(evidence);
  expect(JSON.stringify(evidence)).not.toContain(root);
  expect(JSON.stringify(evidence)).not.toContain('synthetic source');
});
it('detects modified, added, renamed and missing covered inputs and refuses a changed build',()=>{
  const before=sourceInputEvidence(root);
  writeFileSync(join(root,'lib','fixture.txt'),'changed source');
  expect(()=>assertUnchangedSourceInputs(before,root)).toThrow('changed');
  writeFileSync(join(root,'lib','fixture.txt'),'synthetic source');
  expect(sourceInputEvidence(root)).toEqual(before);
  writeFileSync(join(root,'lib','new.ts'),'new source');
  expect(sourceInputEvidence(root)).not.toEqual(before);
  rmSync(join(root,'lib','new.ts'));rmSync(join(root,'lib','fixture.txt'));
  writeFileSync(join(root,'lib','renamed.txt'),'synthetic source');
  expect(sourceInputEvidence(root)).not.toEqual(before);
  rmSync(join(root,'package-lock.json'));
  expect(()=>sourceInputEvidence(root)).toThrow();
});
it('rejects symlink inputs instead of attesting mutable files outside the input roots',()=>{
  symlinkSync(join(root,'package.json'),join(root,'lib','linked.json'));
  expect(()=>sourceInputEvidence(root)).toThrow('symlinks');
});
