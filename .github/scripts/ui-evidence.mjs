import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {appendFileSync,existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const PREFIX='BROSTCO_UI_EVIDENCE_V1',CHUNK=2304;
export const MAX_RAW=256*1024*1024,MAX_ARCHIVE=128*1024*1024;
const sha=b=>createHash('sha256').update(b).digest('hex');
function safePath(p){return typeof p==='string' && !!p && !p.startsWith('/') && !p.includes('\\') && p.split('/').every(s=>s && s!=='.' && s!=='..');}
export function collectFiles(root,label=root,budget={bytes:0}){
  if(!existsSync(root))return [];
  const stat=lstatSync(root);if(stat.isSymbolicLink())throw Error('Evidence symlinks are refused');
  if(stat.isFile()){
    budget.bytes+=stat.size;if(budget.bytes>MAX_RAW)throw Error('Evidence raw byte limit exceeded');
    return [{path:label,bytes:readFileSync(root)}];
  }
  if(!stat.isDirectory())throw Error('Unsupported evidence entry');
  return readdirSync(root).sort().filter(n=>!n.startsWith('.')).flatMap(n=>collectFiles(join(root,n),`${label}/${n}`,budget));
}
export function bundleEvidence(files,context,maxRaw=MAX_RAW){
  for(const k of ['source','runId','runAttempt','job','device'])if(typeof context[k]!=='string' || !context[k])throw Error(`Missing context ${k}`);
  const seen=new Set();let rawBytes=0;
  const entries=files.map(f=>{
    if(!safePath(f.path) || seen.has(f.path))throw Error('Unsafe or duplicate evidence path');seen.add(f.path);
    const b=Buffer.from(f.bytes);rawBytes+=b.length;if(rawBytes>maxRaw)throw Error('Evidence raw byte limit exceeded');
    return {path:f.path,bytes:b.length,sha256:sha(b),base64:b.toString('base64')};
  }).sort((a,b)=>a.path.localeCompare(b.path));
  if(!entries.length)throw Error('No UI evidence was produced');
  const bytes=gzipSync(Buffer.from(JSON.stringify(entries)));
  if(bytes.length>MAX_ARCHIVE)throw Error('Evidence compressed byte limit exceeded');
  return {bytes,metadata:{schema:1,...context,files:entries.length,rawBytes,bytes:bytes.length,sha256:sha(bytes),chunks:Math.ceil(bytes.length/CHUNK)}};
}
export function* frameEvidence({metadata,bytes}){
  yield `${PREFIX} META ${JSON.stringify(metadata)}`;
  for(let i=0;i<metadata.chunks;i++)yield `${PREFIX} CHUNK ${i+1}/${metadata.chunks} ${bytes.subarray(i*CHUNK,(i+1)*CHUNK).toString('base64')}`;
  yield `${PREFIX} END ${metadata.sha256}`;
}
export function recoverEvidence(log,expected){
  const frames=log.split(/\r?\n/).map(l=>l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+/,''))
    .filter(l=>l.startsWith(`${PREFIX} `)).map(l=>l.slice(PREFIX.length+1));
  const metas=frames.filter(l=>l.startsWith('META ')),ends=frames.filter(l=>l.startsWith('END '));
  if(metas.length!==1 || ends.length!==1)throw Error('Missing or duplicate evidence boundary');
  const m=JSON.parse(metas[0].slice(5));
  if(m.schema!==1 || !Number.isInteger(m.bytes) || m.bytes<1 || m.bytes>MAX_ARCHIVE ||
    !Number.isInteger(m.rawBytes) || m.rawBytes<0 || m.rawBytes>MAX_RAW ||
    !Number.isInteger(m.files) || m.files<1 || m.chunks!==Math.ceil(m.bytes/CHUNK) || !/^[a-f0-9]{64}$/.test(m.sha256))throw Error('Invalid metadata');
  for(const k of ['source','runId','runAttempt','job','device'])if(!expected[k] || expected[k]!==m[k])throw Error(`Context mismatch: ${k}`);
  if(ends[0]!==`END ${m.sha256}`)throw Error('Evidence end digest mismatch');
  const chunks=new Map();
  for(const f of frames){
    if(f.startsWith('META ') || f.startsWith('END '))continue;
    const match=/^CHUNK ([1-9]\d*)\/([1-9]\d*) ([A-Za-z0-9+/]+={0,2})$/.exec(f);
    if(!match)throw Error('Invalid frame');const i=Number(match[1]),b=Buffer.from(match[3],'base64');
    if(Number(match[2])!==m.chunks || i>m.chunks || chunks.has(i) || b.toString('base64')!==match[3] ||
      b.length>CHUNK || (i<m.chunks && b.length!==CHUNK))throw Error('Invalid or duplicate chunk');chunks.set(i,b);
  }
  if(chunks.size!==m.chunks)throw Error('Missing chunk');
  const bytes=Buffer.concat(Array.from({length:m.chunks},(_,i)=>chunks.get(i+1)));
  if(bytes.length!==m.bytes || sha(bytes)!==m.sha256)throw Error('Archive digest mismatch');
  const entries=JSON.parse(gunzipSync(bytes,{maxOutputLength:MAX_RAW*2}).toString());
  if(!Array.isArray(entries) || entries.length!==m.files)throw Error('File count mismatch');
  const seen=new Set();let raw=0;
  const files=entries.map(e=>{
    if(!safePath(e.path) || seen.has(e.path) || typeof e.base64!=='string')throw Error('Unsafe or duplicate recovered path');seen.add(e.path);
    const b=Buffer.from(e.base64,'base64');raw+=b.length;
    if(raw>MAX_RAW || b.toString('base64')!==e.base64 || b.length!==e.bytes || sha(b)!==e.sha256)throw Error('File evidence mismatch');
    return {path:e.path,bytes:b,sha256:e.sha256};
  });
  if(raw!==m.rawBytes)throw Error('Raw byte count mismatch');
  return {metadata:m,files};
}
if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  if(process.argv[2]==='emit'){
    const budget={bytes:0};
    const bundle=bundleEvidence([...collectFiles('artifacts/ui-audit','artifacts/ui-audit',budget),...collectFiles('/tmp/ui-server.log','ui-server.log',budget)],{
      source:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,runAttempt:process.env.GITHUB_RUN_ATTEMPT,
      job:process.env.GITHUB_JOB,device:process.env.AUDIT_DEVICE,
    });
    if(!process.env.GITHUB_STEP_SUMMARY)throw Error('Missing summary path');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,`Complete UI evidence: ${JSON.stringify(bundle.metadata)}\n`);
    for(const line of frameEvidence(bundle))if(!process.stdout.write(line+'\n'))await new Promise(r=>process.stdout.once('drain',r));
  }else if(process.argv[2]==='recover'){
    const [,, ,logPath,destination,source,runId,runAttempt,job,device]=process.argv;
    const result=recoverEvidence(readFileSync(logPath,'utf8'),{source,runId,runAttempt,job,device});
    mkdirSync(destination,{mode:0o700});
    for(const f of result.files){const target=join(destination,f.path);mkdirSync(resolve(target,'..'),{recursive:true,mode:0o700});writeFileSync(target,f.bytes,{flag:'wx',mode:0o600});}
    writeFileSync(join(destination,'evidence-metadata.json'),JSON.stringify(result.metadata,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify(result.metadata));
  }else throw Error('Choose emit or recover');
}
