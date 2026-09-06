import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFixture, step, advance, validate, metrics } from './lane-fixture.mjs';

test('all weights and priorities conserve trips and exclude collisions at every tick', () => {
  for (const weight of [1,2,4]) for (const priority of [0,1]) {
    const s = createFixture({weight, priority, demandTicks: 121});
    for(let i=0;i<1200;i++) { step(s); validate(s); }
    assert.deepEqual(s.completed, s.generated); // Includes final short batch.
    assert.deepEqual(s.pending, [[],[]]);
  }
});
test('priority alone changes experienced journey time with identical requests', () => {
  const a = advance(createFixture({priority:0}),1200);
  const b = advance(createFixture({priority:1}),1200);
  assert.deepEqual(a.generated,b.generated);
  assert.notDeepEqual(a.completed,b.completed);
  assert.notDeepEqual(metrics(a).completedMeanJourneySeconds,metrics(b).completedMeanJourneySeconds);
  assert.ok(a.conflictDeniedTicks[1]>0 && b.conflictDeniedTicks[0]>0);
});
test('blocked exits spill back through the conflict and stop upstream admission', () => {
  const s = createFixture({exitClosedUntil:1200});
  for(let i=0;i<1200;i++) { step(s); validate(s); }
  assert.deepEqual(s.completed,[0,0]);
  assert.ok(s.pending[0].length>0 && s.pending[1].length>0);
  assert.ok(s.maxQueuedTrips.some(n=>n>=38));
  advance(s,6000); validate(s);
  assert.deepEqual(s.completed,s.generated);
});
test('slow ticks, fast batches and a mid-queue state copy replay identically', () => {
  const slow = createFixture();
  for(let i=0;i<1200;i++) advance(slow,1);
  const fast = createFixture();
  for(let i=0;i<120;i++) advance(fast,10);
  assert.deepEqual(fast,slow);
  const before = advance(createFixture(),601);
  const copy = structuredClone(before);
  advance(before,599); advance(copy,599);
  assert.deepEqual(before,copy);
  assert.deepEqual(copy,slow);
});
test('free travel establishes a units sanity check, no demand means no samples', () => {
  assert.deepEqual(metrics(createFixture()).completedMeanJourneySeconds,[null,null]);
  const s = advance(createFixture({demandTicks:1,periods:[1,1]}),200);
  assert.deepEqual(s.generated,[1,1]);
  assert.deepEqual(s.completed,[1,1]);
  assert.equal(metrics(s).completedMeanJourneySeconds[0],42.5);
});
