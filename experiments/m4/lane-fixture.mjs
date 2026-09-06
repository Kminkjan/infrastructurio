// Deliberately isolated research model. No application imports or save mutations.
export const UNITS = Object.freeze({ cellMetres: 7.5, tickSeconds: 0.5,
  speedMetresPerSecond: 15, approachCells: 40, conflictCells: 4, exitCells: 40 });

/** Two incoming lanes, two distinct outgoing lanes, one shared turning conflict.
 * A token occupies weight consecutive car+gap cells. It moves one cell per tick.
 * This tests spatial platoon compression, NOT an assumed correct weighting model.
 */
export function createFixture({ weight = 1, priority = 0, demandTicks = 1200,
  periods = [3, 7], exitClosedUntil = 0 } = {}) {
  if (![1, 2, 4].includes(weight) || ![0, 1].includes(priority) ||
      !Number.isInteger(demandTicks) || demandTicks < 0 ||
      periods.length !== 2 || periods.some(p => !Number.isInteger(p) || p < 1) ||
      !Number.isInteger(exitClosedUntil) || exitClosedUntil < 0) throw new RangeError('invalid fixture');
  return { tick: 0, weight, priority, demandTicks, periods: [...periods], exitClosedUntil,
    nextId: 0, lanes: [[], []], pending: [[], []], generated: [0, 0],
    completed: [0, 0], journeySeconds: [0, 0], completedMaxSeconds: [0, 0],
    maxQueuedTrips: [0, 0], maxStoppedTrips: [0, 0], stoppedTripSeconds: [0, 0], maxActiveTokens: 0, conflictDeniedTicks: [0, 0] };
}
const conflictStart = UNITS.approachCells;
const conflictEnd = conflictStart + UNITS.conflictCells;
const routeEnd = conflictEnd + UNITS.exitCells;
const inConflict = v => v.position >= conflictStart && v.position - v.weight + 1 < conflictEnd;

export function step(s) {
  // Individual requested departures remain timestamped until a complete batch exists.
  for (let lane = 0; lane < 2; lane++) {
    if (s.tick < s.demandTicks && s.tick % s.periods[lane] === 0) {
      s.pending[lane].push(s.tick);
      s.generated[lane]++;
    }
  }
  let owner = s.lanes.findIndex(lane => lane.some(inConflict));
  // Priority only changes arbitration. Geometry, demand and vehicle speed are identical.
  for (const laneIndex of [s.priority, 1 - s.priority]) {
    const lane = s.lanes[laneIndex];
    const oldPositions = lane.map(v => v.position);
    let stoppedTrips = 0;
    for (let i = 0; i < lane.length; i++) {
      const v = lane[i];
      let next = v.position + 1;
      // Use the leader's OLD tail: no update-order free cell or overlapping bodies.
      if (i > 0) next = Math.min(next, oldPositions[i - 1] - lane[i - 1].weight);
      if (s.tick < s.exitClosedUntil) next = Math.min(next, routeEnd - 1);
      if (v.position < conflictStart && next >= conflictStart) {
        if (owner !== -1) {
          next = conflictStart - 1;
          s.conflictDeniedTicks[laneIndex]++;
        } else owner = laneIndex;
      }
      if (next === v.position) stoppedTrips += v.weight;
      v.position = next;
    }
    s.maxStoppedTrips[laneIndex] = Math.max(s.maxStoppedTrips[laneIndex], stoppedTrips);
    s.stoppedTripSeconds[laneIndex] += stoppedTrips * UNITS.tickSeconds;
    // Entire token must leave, including its represented spatial footprint.
    while (lane.length && lane[0].position - lane[0].weight + 1 >= routeEnd) {
      const v = lane.shift();
      for (const born of v.departures) {
        const duration = (s.tick + 1 - born) * UNITS.tickSeconds;
        s.completed[laneIndex]++;
        s.journeySeconds[laneIndex] += duration;
        s.completedMaxSeconds[laneIndex] = Math.max(s.completedMaxSeconds[laneIndex], duration);
      }
    }
    const tail = lane.at(-1);
    // Space for a whole platoon at entry; partial batch is released after demand ends.
    const count = Math.min(s.weight, s.pending[laneIndex].length);
    if (count && (count === s.weight || s.tick >= s.demandTicks) &&
        (!tail || tail.position - tail.weight + 1 >= count)) {
      lane.push({ id: s.nextId++, weight: count, position: count - 1,
        departures: s.pending[laneIndex].splice(0, count) });
    }
    const queued = lane.filter(v => v.position < conflictStart).reduce((n,v) => n + v.weight, 0);
    s.maxQueuedTrips[laneIndex] = Math.max(s.maxQueuedTrips[laneIndex], queued);
  }
  s.tick++;
  s.maxActiveTokens = Math.max(s.maxActiveTokens, s.lanes[0].length + s.lanes[1].length);
}
export function advance(s, ticks) {
  if (!Number.isSafeInteger(ticks) || ticks < 0) throw new RangeError('invalid advance');
  for (let i = 0; i < ticks; i++) step(s);
  return s;
}
export function validate(s) {
  const occupants = s.lanes.flat().filter(inConflict);
  if (occupants.length > 1) throw new Error('conflicting occupancy');
  for (let l = 0; l < 2; l++) {
    const lane = s.lanes[l];
    for (let i = 0; i < lane.length; i++) {
      if (i && lane[i].position >= lane[i-1].position - lane[i-1].weight + 1) throw new Error('overlap');
      if (lane[i].departures.length !== lane[i].weight) throw new Error('token accounting');
    }
    if (s.generated[l] !== s.completed[l] + s.pending[l].length + lane.reduce((n,v) => n+v.weight,0))
      throw new Error('trip conservation');
  }
}
export function metrics(s) {
  return { elapsedSeconds: s.tick * UNITS.tickSeconds, generatedTrips: s.generated,
    completedTrips: s.completed, pendingTrips: s.pending.map(p => p.length),
    activeTrips: s.lanes.map(l => l.reduce((n,v) => n+v.weight,0)),
    completedMeanJourneySeconds: s.completed.map((n,i) => n ? s.journeySeconds[i]/n : null),
    unfinishedMeanAgeSeconds: s.lanes.map((lane,i) => {
      const born = [...s.pending[i], ...lane.flatMap(v => v.departures)];
      return born.length ? born.reduce((n,b) => n+(s.tick-b)*UNITS.tickSeconds,0)/born.length : null;
    }), completedMaxSeconds: s.completedMaxSeconds, maxApproachTrips: s.maxQueuedTrips,
    maxStoppedTrips: s.maxStoppedTrips, stoppedTripSeconds: s.stoppedTripSeconds,
    maxActiveTokens: s.maxActiveTokens, conflictDeniedTicks: s.conflictDeniedTicks };
}
