import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory=resolve(process.env.BROSTCO_BUILD_DIR||'.next');
const stamp=JSON.parse(readFileSync(resolve(directory,'runtime-build.json'),'utf8'));
if (!/^[0-9a-f-]{36}$/.test(stamp.buildId) || stamp.workerFile!==`worker-${stamp.buildId}.mjs` ||
  !/^[0-9a-f]{64}$/.test(stamp.workerSha256)) throw Error('Worker build manifest is invalid. Rebuild the reviewed source.');
const file=resolve(directory,stamp.workerFile);
if (createHash('sha256').update(readFileSync(file)).digest('hex')!==stamp.workerSha256)
  throw Error('Worker artifact does not match its build manifest. Refusing to start changed code.');
process.env.BROSTCO_WORKER_ARTIFACT_SHA256=stamp.workerSha256;
await import(pathToFileURL(file).href);
