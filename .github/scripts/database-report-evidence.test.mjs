import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameReport, recoverReport, MAX_REPORT_BYTES } from './database-report-evidence.mjs';

const context = { source: 'a'.repeat(40), runId: '1234', runAttempt: '1', job: 'database' };
const bytes = Buffer.from(JSON.stringify({ numPassedTests: 895, numFailedTests: 0,
  numPendingTests: 0, numFailedTestSuites: 0, success: true,
  details: 'Unicode: π 👩🏽‍💻\nQuoted "result"\n'.repeat(250) }, null, 2));
const framed = () => frameReport(bytes, context).lines;
const recover = (lines) => recoverReport(lines.join('\n'), context);

test('roundtrips exact Unicode/newline bytes through timestamped GitHub-style lines', () => {
  const { lines, metadata } = frameReport(bytes, context);
  assert(lines.every((line) => Buffer.byteLength(line) < 4096));
  assert(metadata.chunks > 1);
  const log = ['unrelated log line', ...lines.map((line) => `2026-10-16T15:30:00.0000000Z ${line}`)].join('\r\n');
  assert.deepEqual(recoverReport(log, context).bytes, bytes);
});
test('rejects missing chunk', () => { const lines = framed(); lines.splice(2, 1); assert.throws(() => recover(lines), /Missing evidence chunk/); });
test('rejects duplicate chunk', () => { const lines = framed(); lines.splice(2, 0, lines[1]); assert.throws(() => recover(lines), /duplicated evidence chunk/); });
test('rejects corrupted payload', () => { const lines = framed(); lines[1] = lines[1].replace(/(CHUNK \d+\/\d+ )([A-Za-z0-9+/])/, (_, prefix, x) => prefix + (x === 'A' ? 'B' : 'A')); assert.throws(() => recover(lines)); });
test('rejects truncated payload', () => { const lines = framed(); lines[1] = lines[1].slice(0, -7); assert.throws(() => recover(lines)); });
test('rejects missing or duplicated boundary', () => {
  assert.throws(() => recover(framed().slice(0, -1)), /boundary/);
  const lines = framed(); lines.push(lines[0]); assert.throws(() => recover(lines), /boundary/);
});
test('rejects source, run or attempt mismatch', () => {
  for (const key of ['source', 'runId', 'runAttempt']) assert.throws(() => recoverReport(framed().join('\n'), { ...context, [key]: 'other' }), /context mismatch/);
});
test('accepts the exact byte ceiling and rejects a larger report before emission', () => {
  const atLimit = Buffer.from(JSON.stringify('x'.repeat(MAX_REPORT_BYTES - 2)));
  assert.equal(atLimit.length, MAX_REPORT_BYTES);
  assert.deepEqual(recoverReport(frameReport(atLimit, context).lines.join('\n'), context).bytes, atLimit);
  assert.throws(() => frameReport(Buffer.concat([atLimit, Buffer.from(' ')]), context), /1 MiB/);
});
