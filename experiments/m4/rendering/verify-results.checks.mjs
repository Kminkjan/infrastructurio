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

// Synthetic v2 report only exercises validation; never used as measurement evidence.
async function modernFixture() {
  const { sources } = await import('./serve-study.mjs');
  const { createHash } = await import('node:crypto');
  const r = structuredClone(original);
  r.schemaVersion = 2; r.sourceHashes = {};
  for (const name of sources) r.sourceHashes[name] = createHash('sha256')
    .update(await readFile(new URL(name, import.meta.url))).digest('hex');
  r.provenance = { method: 'owned-vite-frozen-source-root', sourceHashes: structuredClone(r.sourceHashes) };
  for (const run of r.runs) {
    run.editRebuildRawMs = [1, 2];
    run.editRebuildCpu = { n: 2, median: 2, p95: 2, max: 2, over20ms: 0 };
    for (const sample of run.samples) sample.raw.visibilityEvents = [{ atMs: 0, state: 'visible' }, { atMs: 3500, state: 'visible' }];
  }
  return r;
}
test('v2 validates provenance, raw rebuild series and visibility boundaries', async () => { await verifyReport(await modernFixture()); });
for (const [name, mutate] of Object.entries({
  'different served source': r => { r.provenance.sourceHashes['study.mjs'] = 'wrong'; },
  'hidden then visible': r => { r.runs[0].samples[0].raw.visibilityEvents.splice(1, 0, { atMs: 1000, state: 'hidden' }); },
  'missing visibility start': r => { r.runs[0].samples[0].raw.visibilityEvents.shift(); },
  'unordered visibility': r => { r.runs[0].samples[0].raw.visibilityEvents.reverse(); },
  'short window': r => { r.runs[0].samples[0].raw.visibilityEvents[1].atMs = 20; },
  'invented rebuild summary': r => { r.runs[0].editRebuildCpu.p95 = 99; },
  'missing rebuild raw': r => { r.runs[0].editRebuildRawMs = []; },
  'unknown schema': r => { r.schemaVersion = 3; },
})) test(`v2 rejects ${name}`, async () => {
  const report = await modernFixture(); mutate(report);
  await assert.rejects(() => verifyReport(report));
});
test('committed v2 paired report passes including raw rebuild and visibility records', async () => {
  await verifyReport(JSON.parse(await readFile(new URL('../../../docs/research/m4/rendering/results-v2.json', import.meta.url), 'utf8')));
});
