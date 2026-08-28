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

## M3 release measurement

Issue #19 defines a repeatable target-scale fixture rather than extrapolating
from the starting map. The fixture contains 12 authored road segments and 14
derived road links, 6 rail tracks and 6 rail links, 3 terminals, two active
supply-chain legs, 7 development marks, 2 route-overlay features, and 10
representative vehicles. The portable fixture and complete reproduction steps
are recorded in [M3 release validation](m3-release-validation.md).

Reference environment measured on 2026-08-28:

- MacBook Pro (Mac17,8), Apple M5 Pro, 18 cores, 48 GB memory;
- macOS 26.5.1, arm64, Node.js 26.6.0;
- Codex in-app Chromium browser at 1280 × 720 CSS pixels and 2× device scale;
- development server and no other intentional simulation workload.

`npm run measure:m3` takes 25 warmed samples against a restored copy of the
target fixture. The recorded result was:

| Headless operation | Median | p95 | Maximum |
| --- | ---: | ---: | ---: |
| One-tick simulation step and returned snapshot | 0.93 ms | 1.60 ms | 1.68 ms |
| Eight-tick advance crossing route assignment | 0.83 ms | 1.54 ms | 1.71 ms |
| Seven-day sustained run (21 assignments and 7 daily boundaries) | 1.57 ms | 2.20 ms | 2.46 ms |
| Current snapshot with bounded consequence forecast | 0.62 ms | 0.98 ms | 1.01 ms |
| Serialize version-9 save | 0.04 ms | 0.10 ms | 0.11 ms |

The development-only Pixi ticker sampler recorded 180 frames after importing the
same fixture: 8.50 ms average, 9.20 ms p95, 16.70 ms maximum, 117.65 average
frames/second, and no frames over 20 ms or 33 ms. The browser smoke also covered
zoom, fit, local save/load, import, and an eight-hour advance with no console
errors.

The accepted M3 limits are 250 ms p95 for each bounded headless regression
sample, 20 ms p95 browser frame pacing on the reference environment, and no
frame above 33 ms in the bounded browser sample. The 250 ms automated ceiling is
a coarse catastrophic-regression guard, not the observed performance target;
the recorded values are the useful baseline.

Profiling did not identify a material hot path, so no simulation or renderer
optimization was introduced. In particular, pairwise topology rebuilds,
all-or-nothing assignment, main-thread simulation, complete snapshot rebuilding,
and JSON saves remain accepted at M3 scale. Incremental topology, equilibrium or
hierarchical routing, worker transfer optimization, larger-map detail reduction,
and broader hardware targets remain deferred until a measured scenario requires
them.

For M0 map navigation, pointer and wheel input updates a single world-container
transform; static geography and selection hit targets are rebuilt only when the
geography snapshot changes. Road visuals and their hit targets are rebuilt only
after an authoritative road-network edit. The M0 graph rebuild uses pairwise
segment intersection checks; it favors simple, reproducible behavior at the toy
network size over incremental topology maintenance. Profile and replace that
strategy only when a defined scenario demonstrates it is material. The current
roadmap does not define a numeric M0 object-count target, so these are architectural
guardrails rather than a frame-time claim. The M3 target fixture and frame-time
budget above supersede that earlier absence for the vertical-slice scale only.

The freight renderer uses one representative truck or train per 20 assigned tons per
day per leg. At the current 120-ton inbound and 100-ton outbound maxima, the
two-leg supply chain therefore produces at most eleven freight graphics. Those
graphics are reused while their visual trips are active and removed at
destinations, on route changes, or on disconnection. This is a scenario-specific
display count, not a general traffic capacity target.

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

Multimodal freight assignment runs every eight simulated ticks (eight hours) and
immediately after a relevant infrastructure or price edit. A multi-tick advance processes each crossed
assignment boundary deterministically, while representative freight motion
continues on the render-frame clock. Stoneworks inventories and processing run
only at crossed daily boundaries. The current network and two aggregate freight
origin-destination pairs are intentionally small; incremental or equilibrium
assignment is deferred until measured flow counts make it necessary.
