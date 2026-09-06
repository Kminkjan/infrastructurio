import { cpus, totalmem, arch } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createFixture, advance, step, validate, metrics, UNITS } from './lane-fixture.mjs';

// Bounds specified before running comparisons. Reject a factor on any lane/case.
const bounds = { completedTripsRelative: 0.05, journeySecondsRelative: 0.10,
  journeySecondsAbsolute: 1, maxApproachTripsRelative: 0.10, maxApproachTripsAbsolute: 2 };
const comparisons = [];
for (const periods of [[20,40],[3,7]]) for (const priority of [0,1]) {
  const runs = [1,2,4].map(weight => {
    const s = createFixture({weight,priority,periods});
    for(let i=0;i<1200;i++) { step(s); validate(s); }
    const atHorizon = structuredClone(metrics(s));
    let drainTicks = 0;
    while(s.completed.some((n,i)=>n<s.generated[i]) && drainTicks<12000) {
      step(s); validate(s); drainTicks++;
    }
    if(s.completed.some((n,i)=>n!==s.generated[i])) throw Error('failed to drain');
    return {weight, atHorizon, drained:metrics(s)};
  });
  for (const run of runs.slice(1)) {
    const base = runs[0];
    run.errors = [0,1].map(lane => {
      const completedRelative = Math.abs(run.atHorizon.completedTrips[lane]-base.atHorizon.completedTrips[lane])/
        Math.max(1,base.atHorizon.completedTrips[lane]);
      // Use fully drained means so censoring cannot select easier completed trips.
      const journeySeconds = Math.abs(run.drained.completedMeanJourneySeconds[lane]-base.drained.completedMeanJourneySeconds[lane]);
      const queueTrips = Math.abs(run.atHorizon.maxApproachTrips[lane]-base.atHorizon.maxApproachTrips[lane]);
      return { lane, completedRelative, journeySeconds, queueTrips,
        accepted: completedRelative<=bounds.completedTripsRelative &&
          journeySeconds<=Math.max(bounds.journeySecondsAbsolute, bounds.journeySecondsRelative*base.drained.completedMeanJourneySeconds[lane]) &&
          queueTrips<=Math.max(bounds.maxApproachTripsAbsolute,bounds.maxApproachTripsRelative*base.atHorizon.maxApproachTrips[lane]) };
    });
  }
  comparisons.push({periodsTicks:periods,priority,runs});
}
function distribution(values) {
  const v = [...values].sort((a,b)=>a-b);
  return {samples:v.length,medianMs:v[Math.floor(v.length*.5)],p95Ms:v[Math.ceil(v.length*.95)-1],maxMs:v.at(-1)};
}
// Replicated disconnected junctions measure movement cost only, never region routing.
const repetitions = [];
for(let rep=0;rep<5;rep++) {
  const fixtures = Array.from({length:32},(_,i)=>createFixture({priority:i%2,demandTicks:100000}));
  for(const f of fixtures) advance(f,600);
  const tickMs=[], snapshotMs=[], serializeMs=[];
  let maxActiveTokens=0, maxPendingTrips=0, snapshotBytes=0;
  for(let i=0;i<1200;i++) {
    const start=performance.now();
    for(const f of fixtures) step(f);
    tickMs.push(performance.now()-start);
    maxActiveTokens=Math.max(maxActiveTokens,fixtures.reduce((n,f)=>n+f.lanes.flat().length,0));
    maxPendingTrips=Math.max(maxPendingTrips,fixtures.reduce((n,f)=>n+f.pending.flat().length,0));
    if(i%10===0) {
      const startSnapshot=performance.now();
      const snapshot=fixtures.map(f=>({tick:f.tick,vehicles:f.lanes.map(l=>l.map(v=>({id:v.id,position:v.position,weight:v.weight}))),metrics:metrics(f)}));
      snapshotMs.push(performance.now()-startSnapshot);
      const startSerialize=performance.now();
      const serialized=JSON.stringify(snapshot);
      serializeMs.push(performance.now()-startSerialize);
      snapshotBytes=Math.max(snapshotBytes,Buffer.byteLength(serialized));
    }
  }
  for(const f of fixtures) validate(f);
  const batchMs = [];
  const sequential = structuredClone(fixtures);
  for(let batch=0;batch<100;batch++) {
    const start=performance.now();
    for(let tick=0;tick<10;tick++) for(const f of fixtures) step(f);
    batchMs.push(performance.now()-start);
  }
  for(let tick=0;tick<1000;tick++) for(const f of sequential) step(f);
  if(JSON.stringify(fixtures)!==JSON.stringify(sequential)) throw Error('fast-forward replay mismatch');
  repetitions.push({tenTickBatch:distribution(batchMs),tick:distribution(tickMs),snapshot:distribution(snapshotMs),serialize:distribution(serializeMs),
    maxActiveTokens,maxPendingTrips,snapshotBytes});
}
const result={schemaVersion:1,recordedAt:new Date().toISOString(),
  baseline:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  sourceHashes:Object.fromEntries(['lane-fixture.mjs','lane-fixture.checks.mjs','run-lane-study.mjs'].map(name=>
    [name,createHash('sha256').update(readFileSync(new URL(name,import.meta.url))).digest('hex')])),
  environment:{cpu:cpus()[0]?.model,logicalCpus:cpus().length,memoryGiB:totalmem()/2**30,arch:arch(),node:process.version,
    os:execFileSync('sw_vers',['-productVersion'],{encoding:'utf8'}).trim()},
  units:UNITS,bounds,comparisons,
  benchmark:{junctions:32,directionalLanes:128,routeCellsPerMovement:84,warmupTicks:600,measuredTicks:1200,repetitions},
  limitations:['Discrete constant-speed cell model; no acceleration, lane changes, signals, route choice or mixed vehicle sizes.',
    'Weights are spatial platoon batches, not independent vehicles; acceptance is measured, not assumed.',
    'Benchmark junctions are disconnected replicas; no connected-region, browser, rendering, accessibility or development cost measured.',
    'No human interaction or readability validation performed.']};
const output=process.argv[2];
if(output) writeFileSync(output,JSON.stringify(result,null,2)+'\n');
else console.log(JSON.stringify(result,null,2));
