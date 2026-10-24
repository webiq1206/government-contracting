import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {bundleEvidence,frameEvidence,recoverEvidence,collectFiles} from './ui-evidence.mjs';
const context={source:'a'.repeat(40),runId:'123',runAttempt:'1',job:'browser',device:'desktop'};
const files=[{path:'artifacts/ui-audit/desktop.png',bytes:Buffer.from(Array.from({length:12000},(_,i)=>(i*i+3*i)%251))},{path:'ui-server.log',bytes:Buffer.from('Synthetic fixture only: π\n')}];
const lines=()=>[...frameEvidence(bundleEvidence(files,context))];
test('preserves every original binary/text byte with source/run/device provenance',()=>{
 const log=lines().map(l=>'2026-10-23T15:00:00.0000000Z '+l).join('\r\n');
 assert.deepEqual(recoverEvidence(log,context).files.map(f=>f.bytes),files.map(f=>f.bytes));
 assert(lines().every(l=>Buffer.byteLength(l)<4096));
});
test('rejects missing, duplicate, corrupt and truncated frames',()=>{
 const source=lines();
 for(const changed of [source.slice(0,-1),[...source,source[0]],[...source.slice(0,1),...source.slice(2)],[...source.slice(0,2),source[1],...source.slice(2)]])assert.throws(()=>recoverEvidence(changed.join('\n'),context));
 const changed=lines();changed[1]=changed[1].slice(0,-3);assert.throws(()=>recoverEvidence(changed.join('\n'),context));
});
test('rejects any source, run, attempt, job or device mismatch',()=>{
 for(const k of Object.keys(context))assert.throws(()=>recoverEvidence(lines().join('\n'),{...context,[k]:'other'}),/Context mismatch/);
});
test('rejects traversal, duplicate paths, empty evidence and byte-limit overflow',()=>{
 for(const path of ['../escape','/absolute','a/../escape','a\\escape'])assert.throws(()=>bundleEvidence([{path,bytes:Buffer.from('x')}],context));
 assert.throws(()=>bundleEvidence([files[0],files[0]],context));assert.throws(()=>bundleEvidence([],context));assert.throws(()=>bundleEvidence(files,context,1));
});
test('does not export symlinks or private hidden files',()=>{
 const root=mkdtempSync(join(tmpdir(),'brostco-evidence-'));
 try{writeFileSync(join(root,'.hidden'),'not exported');assert.deepEqual(collectFiles(root,'evidence'),[]);symlinkSync('/etc/passwd',join(root,'link'));assert.throws(()=>collectFiles(root,'evidence'),/symlinks/);}finally{rmSync(root,{recursive:true,force:true});}
});
test('recovery independently rejects forged unsafe paths, duplicates and file hashes',()=>{
 const entry={path:'safe.png',bytes:1,base64:Buffer.from('x').toString('base64'),sha256:createHash('sha256').update('x').digest('hex')};
 for(const entries of [[{...entry,path:'../outside'}],[entry,entry],[{...entry,sha256:'0'.repeat(64)}]]){
  const bytes=gzipSync(Buffer.from(JSON.stringify(entries))),metadata={schema:1,...context,files:entries.length,rawBytes:entries.length,
   bytes:bytes.length,chunks:Math.ceil(bytes.length/2304),sha256:createHash('sha256').update(bytes).digest('hex')};
  assert.throws(()=>recoverEvidence([...frameEvidence({bytes,metadata})].join('\n'),context));
 }
});
