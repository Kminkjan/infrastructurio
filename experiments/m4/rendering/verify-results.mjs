import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {defaultControls} from './scene.mjs';

const sources = ['scene.mjs','pixi-view.mjs','three-view.mjs','study.mjs','index.html',
  'run-study.mjs','../../../src/rendering/map-camera.ts','../../../package-lock.json'];
const tasks = ['draw-s-curve','reshape','turn-lane','elevated-crossing',
  'obscured-queue-direct','obscured-queue-filtered','keyboard-queue-list','keyboard-reshape'];
function sameMembers(actual, expected, label) {
  assert.deepEqual([...actual].sort(), [...expected].sort(), label);
}
function stats(values, minimum = 100) {
  assert.ok(values.length >= minimum, 'Enough raw samples');
  assert.ok(values.every(v => Number.isFinite(v) && v >= 0), 'Finite nonnegative timings');
  const sorted = [...values].sort((a,b) => a-b);
  // Preserve the original runner's percentile convention when auditing its report.
  return {n: sorted.length, median: sorted[Math.floor(sorted.length*.5)],
    p95: sorted[Math.floor(sorted.length*.95)], max: sorted.at(-1),
    over20ms: sorted.filter(v => v > 20).length};
}
function distance(actual, expected) {
  assert.equal(actual.length, 2);
  assert.ok(actual.every(Number.isFinite));
  return Math.hypot(actual[0]-expected[0], actual[1]-expected[1]);
}
export async function verifyReport(report) {
  assert.ok(report.schemaVersion === undefined || report.schemaVersion === 2, 'Known schema');
  const modern = report.schemaVersion === 2;
  const expectedSources = modern ? [...sources, 'serve-study.mjs', 'human-session.mjs'] : sources;
  sameMembers(Object.keys(report.sourceHashes), expectedSources, 'Complete source manifest');
  const sourceRoot = modern ? import.meta.url : new URL('../../../docs/research/m4/rendering/source-v1/experiments/m4/rendering/', import.meta.url);
  for(const name of expectedSources) {
    assert.equal(createHash('sha256').update(await readFile(new URL(name,sourceRoot))).digest('hex'),
      report.sourceHashes[name], `Source changed: ${name}`);
  }
  if (modern) {
    assert.equal(report.provenance.method, 'owned-vite-frozen-source-root');
    assert.deepEqual(report.provenance.sourceHashes, report.sourceHashes, 'Served snapshot matches measured source');
  }
  sameMembers(report.runs.map(r => r.mode), ['2d','3d'], 'One run of each renderer');
  for(const run of report.runs) {
    assert.deepEqual(run.errors, []);
    assert.equal(run.info.backend, run.mode === '2d' ? 'Pixi WebGL' : 'Three.js WebGL2');
    assert.equal(run.info.dpr, 1);
    assert.deepEqual(run.info.viewport, [960,600]);
    sameMembers(run.observations.map(o => o.task), tasks, 'Unique complete task coverage');
    const byTask = Object.fromEntries(run.observations.map(o => [o.task,o]));
    const draw = byTask['draw-s-curve'];
    assert.equal(draw.controls.length, 4);
    const drawError = Math.max(...draw.controls.map((p,i) => distance(p,defaultControls[i])));
    assert.equal(draw.maxWorldError, drawError);
    assert.ok(drawError < .01, 'Draw round-trip tolerance 1 cm');
    const reshapeError = distance(byTask.reshape.point, [280,110]);
    assert.equal(byTask.reshape.worldError, reshapeError);
    assert.ok(reshapeError < .01, 'Reshape round-trip tolerance 1 cm');
    for(const [task, target] of Object.entries({'turn-lane':'turn-lane',
      'elevated-crossing':'bridge','obscured-queue-filtered':'queue-0'})) {
      assert.equal(byTask[task].expected,target,task);
      assert.equal(byTask[task].actual,target,task);
    }
    assert.equal(byTask['elevated-crossing'].elevationAfter,50);
    assert.equal(byTask['obscured-queue-direct'].expected,'queue-0');
    assert.equal(byTask['obscured-queue-direct'].actual,'bridge','Expected occlusion');
    assert.match(byTask['obscured-queue-filtered'].text,/Cause: yield to conflicting turn \(authored fixture\)/);
    assert.equal(byTask['keyboard-queue-list'].actual,'queue-0');
    assert.deepEqual(byTask['keyboard-reshape'].delta,[5,0]);
    if (modern) assert.deepEqual(run.editRebuildCpu, stats(run.editRebuildRawMs, 1), 'Rebuild summary matches raw data');
    sameMembers(run.samples.map(s => `${s.workload}:${s.repeat}`),
      ['editing:0','editing:1','editing:2','stress:0','stress:1','stress:2'], 'Workload/repeat coverage');
    for(const sample of run.samples) {
      if (modern) {
        const events = sample.raw.visibilityEvents;
        assert.ok(Array.isArray(events) && events.length >= 2, 'Visibility start and end required');
        for (const [i, event] of events.entries()) {
          assert.equal(event.state, 'visible', 'Sample interrupted by background visibility');
          assert.ok(Number.isFinite(event.atMs) && event.atMs >= 0);
          if (i) assert.ok(event.atMs >= events[i-1].atMs, 'Ordered visibility events');
        }
        assert.ok(events.at(-1).atMs - events[0].atMs >= 3000, 'Full sampling window');
      }
      // Historic reports only record end visibility.
      assert.equal(sample.raw.visibility,'visible');
      assert.deepEqual(sample.frame,stats(sample.raw.frameIntervalsMs),'Frame summary matches raw data');
      assert.deepEqual(sample.cpu,stats(sample.raw.updateAndSubmitMs),'CPU summary matches raw data');
      assert.equal(sample.cpu.n,sample.frame.n+1,'First frame has CPU cost but no interval');
    }
  }
}
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyReport(JSON.parse(await readFile(process.argv[2] ?? 'docs/research/m4/rendering/results.json','utf8')));
  console.log('Verified source manifest, paired tasks and raw summaries. Schema v1 retains historic visibility/rebuild limits; v2 checks visibility events and raw rebuilds. Neither validates human usability or GPU time.');
}
