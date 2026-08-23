# Performance Strategy

Performance work should preserve simulation meaning. The goal is not to simulate every object equally; it is to allocate detail where it affects decisions or player understanding.

## Principles

### Aggregate flows, sample visuals

Freight, commuting, and passenger demand can be assigned between zones or actors. Visible vehicles represent samples of those flows. A vehicle need not remain a persistent economic entity unless persistence creates gameplay.

### Use multiple update frequencies

Rendering, vehicle motion, routing, production, development, and regional economics do not need the same tick rate. Slow systems should not consume per-frame work.

### Recalculate incrementally

Network edits mark affected nodes, links, zones, and cached accessibility values as dirty. A new local road should not force every location on the map to recalculate immediately.

### Route hierarchically

Large networks can separate local access, regional corridors, and long-distance travel. Detailed routing is concentrated near origins, destinations, transfers, and active bottlenecks.

### Reduce distant detail

Districts retain authoritative population, employment, production, and demand. Individual buildings and vehicles may use lower-frequency or visual-only representations away from the active view.

### Bound work per frame

Expensive updates can be spread over multiple frames or simulation ticks. The UI should remain responsive while background results converge.

## Measurement

Track at least:

- Render time
- Simulation step time by subsystem
- Path and accessibility recalculation counts
- Worker message size and frequency
- Entity, building, network-node, and representative-vehicle counts
- Time spent serializing saves and snapshots

Performance targets should be attached to a defined scenario and hardware class rather than asserted globally.

## Optimization order

1. Reduce unnecessary calculations.
2. Recalculate only affected state.
3. Lower update frequency where behavior permits.
4. Improve algorithms and graph structure.
5. Use typed arrays and transferable buffers for hot data.
6. Consider WebAssembly for measured CPU-heavy kernels.
7. Consider GPU compute only for a proven, suitable workload.

## Prototype constraint

The vertical slice should prove smooth interaction before pursuing very large maps. Premature scale can hide whether the underlying loop is actually fun.

For M0 map navigation, pointer and wheel input updates a single world-container
transform; static geography and selection hit targets are rebuilt only when the
geography snapshot changes. Road visuals and their hit targets are rebuilt only
after an authoritative road-network edit. The M0 graph rebuild uses pairwise
segment intersection checks; it favors simple, reproducible behavior at the toy
network size over incremental topology maintenance. Profile and replace that
strategy only when a defined scenario demonstrates it is material. The current
roadmap does not define a numeric M0 object-count target, so these are architectural
guardrails rather than a frame-time claim. Representative traffic now establishes
the scenario-specific display count below; a hardware frame-time budget remains
future measurement work.

The M0 quarry renderer now uses one representative vehicle per 20 assigned tons
per day. The current scenario's 100-ton daily demand therefore produces at most
five freight graphics. Those graphics are reused while their visual trips are
active and removed at destinations, on route changes, or on disconnection. This
is a scenario-specific display count, not a general traffic capacity target.

The accessibility research prototype caches results per candidate location. A
location's first dependency boundary is its complete reachable road component. A
road edit compares component topology fingerprints, then probes opportunity costs
only for candidates in changed components. A candidate's score cache is invalidated
only when one or more of those costs changed; candidates in untouched components
and candidates unaffected by a harmless spur retain their previous result objects.
Large connected networks may eventually need edit-region or dynamic shortest-path
indexing to narrow the cost-probe step, but that complexity is deferred until the
prototype has a measured need.

Development evaluation runs only at weekly simulation boundaries or when a
network edit changes current pressure. The M1 toy has two candidates and at most
one new regional construction project per weekly evaluation, so it does not add
per-frame simulation work. Building marks are reconstructed from the small
development snapshot only when that snapshot changes.

Road traffic assignment runs every eight simulated ticks (eight hours) and
immediately after a network edit. A multi-tick advance processes each crossed
assignment boundary deterministically, while representative freight motion
continues on the render-frame clock. The current network and single freight
origin-destination pair are intentionally small; incremental or equilibrium
assignment is deferred until multiple measured flows make it necessary.
