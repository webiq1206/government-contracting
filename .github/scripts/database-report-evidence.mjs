import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_REPORT_BYTES = 1024 * 1024;
export const RAW_CHUNK_BYTES = 2304; // Base64 payload 3 KiB; complete line stays below 4 KiB.
const PREFIX = 'BROSTCO_DB_REPORT_V1';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function frameReport(input, context) {
  const bytes = Buffer.from(input);
  if (!bytes.length || bytes.length > MAX_REPORT_BYTES) throw new Error('Database evidence exceeds the 1 MiB limit or is empty');
  const report = JSON.parse(bytes.toString('utf8'));
  for (const key of ['source', 'runId', 'runAttempt', 'job']) {
    if (typeof context[key] !== 'string' || !context[key]) throw new Error(`Missing evidence context: ${key}`);
  }
  const metadata = {
    schema: 1, source: context.source, runId: context.runId,
    runAttempt: context.runAttempt, job: context.job,
    bytes: bytes.length, sha256: digest(bytes), chunks: Math.ceil(bytes.length / RAW_CHUNK_BYTES),
    passed: report.numPassedTests, failed: report.numFailedTests,
    skipped: report.numPendingTests, failedSuites: report.numFailedTestSuites,
    success: report.success,
  };
  const lines = [`${PREFIX} META ${JSON.stringify(metadata)}`];
  for (let i = 0; i < metadata.chunks; i++) {
    const chunk = bytes.subarray(i * RAW_CHUNK_BYTES, (i + 1) * RAW_CHUNK_BYTES);
    lines.push(`${PREFIX} CHUNK ${i + 1}/${metadata.chunks} ${chunk.toString('base64')}`);
  }
  lines.push(`${PREFIX} END ${metadata.sha256}`);
  if (lines.some((line) => Buffer.byteLength(line) > 4096)) throw new Error('Evidence line exceeds 4 KiB');
  return { metadata, lines };
}

export function recoverReport(log, expected) {
  const frames = [];
  for (const line of log.split(/\r?\n/)) {
    // The raw GitHub job-log endpoint prefixes lines with an ISO UTC timestamp.
    const clean = line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+/, '');
    if (clean.startsWith(`${PREFIX} `)) frames.push(clean.slice(PREFIX.length + 1));
  }
  const metas = frames.filter((line) => line.startsWith('META '));
  const ends = frames.filter((line) => line.startsWith('END '));
  if (metas.length !== 1 || ends.length !== 1) throw new Error('Missing or duplicated evidence boundary');
  const metadata = JSON.parse(metas[0].slice(5));
  if (metadata.schema !== 1 || !Number.isInteger(metadata.bytes) || metadata.bytes < 1 || metadata.bytes > MAX_REPORT_BYTES ||
      metadata.chunks !== Math.ceil(metadata.bytes / RAW_CHUNK_BYTES) || !/^[a-f0-9]{64}$/.test(metadata.sha256)) {
    throw new Error('Invalid evidence metadata');
  }
  for (const key of ['source', 'runId', 'runAttempt']) {
    if (typeof expected[key] !== 'string' || metadata[key] !== expected[key]) throw new Error(`Evidence context mismatch: ${key}`);
  }
  if (ends[0] !== `END ${metadata.sha256}`) throw new Error('Evidence end digest mismatch');
  const chunks = new Map();
  for (const frame of frames) {
    if (frame.startsWith('META ') || frame.startsWith('END ')) continue;
    const match = /^CHUNK ([1-9]\d*)\/([1-9]\d*) ([A-Za-z0-9+/]+={0,2})$/.exec(frame);
    if (!match) throw new Error('Invalid evidence frame');
    const index = Number(match[1]);
    if (Number(match[2]) !== metadata.chunks || index > metadata.chunks || chunks.has(index)) throw new Error('Invalid or duplicated evidence chunk');
    const chunk = Buffer.from(match[3], 'base64');
    if (chunk.toString('base64') !== match[3] || chunk.length > RAW_CHUNK_BYTES ||
        (index < metadata.chunks && chunk.length !== RAW_CHUNK_BYTES)) throw new Error('Invalid chunk encoding or length');
    chunks.set(index, chunk);
  }
  if (chunks.size !== metadata.chunks) throw new Error('Missing evidence chunk');
  const bytes = Buffer.concat(Array.from({ length: metadata.chunks }, (_, i) => chunks.get(i + 1)));
  if (bytes.length !== metadata.bytes || digest(bytes) !== metadata.sha256) throw new Error('Evidence bytes or digest mismatch');
  JSON.parse(bytes.toString('utf8'));
  return { bytes, metadata };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv[2] === 'emit') {
    const { metadata, lines } = frameReport(readFileSync(process.argv[3]), {
      source: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT, job: process.env.GITHUB_JOB,
    });
    // Metadata survives even if the runner is interrupted while printing payload chunks.
    if (!process.env.GITHUB_STEP_SUMMARY) throw new Error('Missing GitHub job summary path');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Database evidence: ${JSON.stringify(metadata)}\n`);
    for (const line of lines) console.log(line);
  } else if (process.argv[2] === 'recover') {
    const [, , , logPath, outputPath, source, runId, runAttempt] = process.argv;
    if (!outputPath) throw new Error('Usage: recover LOG OUTPUT EXPECTED_SHA RUN_ID ATTEMPT');
    const { bytes, metadata } = recoverReport(readFileSync(logPath, 'utf8'), { source, runId, runAttempt });
    writeFileSync(outputPath, bytes, { flag: 'wx', mode: 0o600 });
    writeFileSync(`${outputPath}.evidence.json`, JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ saved: resolve(outputPath), ...metadata }));
  } else {
    throw new Error('Choose emit or recover');
  }
}
