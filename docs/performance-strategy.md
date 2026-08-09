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

