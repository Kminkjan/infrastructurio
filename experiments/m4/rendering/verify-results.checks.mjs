import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyReport} from './verify-results.mjs';
const original = JSON.parse(await readFile(new URL('../../../docs/research/m4/rendering/results.json',import.meta.url),'utf8'));
test('committed paired report passes independent summary verification', async () => {
  await verifyReport(original);
});
for(const [name, mutate] of Object.entries({
  'missing source manifest': r => {r.sourceHashes = {};},
  'duplicate renderer': r => {r.runs[1] = structuredClone(r.runs[0]);},
  'duplicate workload': r => {r.runs[0].samples[3] = structuredClone(r.runs[0].samples[0]);},
  'invented frame p95': r => {r.runs[0].samples[0].frame.p95 = 0;},
  'invented CPU p95': r => {r.runs[0].samples[0].cpu.p95 = 999;},
  'self-agreeing wrong selection': r => {Object.assign(r.runs[0].observations[2],{actual:'ground',expected:'ground'});},
  'false draw precision': r => {r.runs[0].observations[0].controls[0][0] += 10;},
  'duplicate task': r => {r.runs[0].observations.push(r.runs[0].observations[0]);},
  'missing CPU sample': r => {r.runs[0].samples[0].raw.updateAndSubmitMs.pop();},
})) test(`rejects ${name}`, async () => {
  const report = structuredClone(original); mutate(report);
  await assert.rejects(() => verifyReport(report));
});
