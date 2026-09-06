import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const path=process.argv[2]??'docs/research/m4/rendering/results.json';
const report=JSON.parse(await readFile(path,'utf8'));
assert.equal(report.runs.length,2);
for(const [name,hash] of Object.entries(report.sourceHashes)){
 assert.equal(createHash('sha256').update(await readFile(new URL(name,import.meta.url))).digest('hex'),hash,`Source changed: ${name}`);
}
for(const run of report.runs){
 assert.deepEqual(run.errors,[]);
 const byTask=Object.fromEntries(run.observations.map(o=>[o.task,o]));
 assert.ok(byTask['draw-s-curve'].maxWorldError<0.01,'Draw round-trip tolerance 1 cm');
 assert.ok(byTask.reshape.worldError<0.01,'Reshape round-trip tolerance 1 cm');
 for(const task of ['turn-lane','elevated-crossing','obscured-queue-filtered'])assert.equal(byTask[task].actual,byTask[task].expected,task);
 assert.equal(byTask['elevated-crossing'].elevationAfter,50);
 assert.equal(byTask['obscured-queue-direct'].actual,'bridge','Expected occlusion is recorded, not silently treated as queue selection');
 assert.equal(byTask['keyboard-queue-list'].actual,'queue-0');
 assert.deepEqual(byTask['keyboard-reshape'].delta,[5,0]);
 assert.equal(run.samples.length,6);
 for(const sample of run.samples){
  assert.equal(sample.raw.visibility,'visible');
  assert.ok(sample.raw.frameIntervalsMs.length>=100);
  assert.equal(sample.frame.n,sample.raw.frameIntervalsMs.length);
  assert.equal(sample.cpu.n,sample.raw.updateAndSubmitMs.length);
  for(const values of [sample.raw.frameIntervalsMs,sample.raw.updateAndSubmitMs])assert.ok(values.every(v=>Number.isFinite(v)&&v>=0));
 }
}
console.log('Paired interaction outcomes, visible sample coverage and source hashes verified. This does not validate human usability or GPU timings.');
