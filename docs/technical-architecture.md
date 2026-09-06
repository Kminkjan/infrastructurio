# Technical Architecture

> Scope note (2026-09-06): This document describes the M0–M3 foundation. The [next prototype plan](next-prototype-plan.md) supersedes its future product direction. Existing aggregate flows and decorative vehicle animation do not satisfy the new causal traffic contract.

## Prototype stack

- **TypeScript:** shared language and strict domain types
- **Vite:** local development and production bundling
- **PixiJS:** GPU-accelerated 2D world rendering
- **React:** DOM-based tools, inspectors, menus, and charts
- **Web Worker:** background simulation execution
- **IndexedDB:** local saved games
- **Vitest:** deterministic behavioral tests

WebGL should be the initial renderer. WebGPU-specific work is deferred until it solves a measured problem.

## Architectural boundaries

```text
React UI
  | commands and queries
  v
Simulation protocol
  | worker messages
  v
Simulation core  <---->  persistence
  | snapshots and events
  v
PixiJS renderer
```

### Simulation core

The simulation is authoritative. It owns world time, networks, actors, economic state, route choice, development decisions, and seeded randomness.

It must not import React, PixiJS, browser DOM APIs, or presentation-specific state.

### Renderer

The renderer consumes snapshots and changes visual state. It may interpolate motion and manage selection highlighting, but it does not make economic or routing decisions.

Suggested layers:

- Terrain
- Infrastructure
- Buildings
- Representative vehicles
- Analysis overlays
- Construction preview

### UI

React owns construction tools, inspectors, settings, notifications, and charts. It sends typed commands and queries rather than mutating simulation objects.

### Worker protocol

Commands describe player intent:

```ts
type SimulationCommand =
  | { type: "advance"; ticks: number }
  | { type: "build-road"; road: RoadSpec }
  | { type: "upgrade-road"; roadSegmentId: EntityId }
  | { type: "remove-entity"; entityId: EntityId }
  | { type: "set-policy"; policy: Policy };
```

Messages describe observable results:

```ts
type SimulationMessage =
  | { type: "snapshot"; snapshot: RenderSnapshot }
  | { type: "changes"; changes: RenderChanges }
  | { type: "event"; event: SimulationEvent }
  | { type: "inspection"; result: InspectionResult };
```

The first implementation may run on the main thread, but it should use the same command-oriented interface.

## Determinism

Given the same version, seed, starting state, and ordered commands, the simulation should produce the same result.

Requirements:

- Fixed simulation steps
- Seeded pseudo-randomness
- Stable iteration order where outcomes depend on order
- Explicit save format versions
- Behavioral scenario tests

Determinism enables reproducible bugs, fast-forward testing, replays, and trustworthy balancing comparisons.

## Initial source shape

```text
src/
  app/
  rendering/
    layers/
  simulation/
    economy/
    growth/
    transport/
  worker/
  scenarios/
  persistence/
  shared/
```

Start with readable maps, arrays, and adjacency lists. Introduce entity-component systems, typed-array storage, WebAssembly, or GPU compute only after profiling identifies a relevant bottleneck.

## Current foundation

The web scaffold establishes four public module entry points:

| Module | Responsibility | Allowed foundation dependencies |
| --- | --- | --- |
| `src/shared` | Commands and serializable snapshots | None |
| `src/scenarios` | Deterministic scenario geography generation | `shared` types only |
| `src/simulation` | Authoritative deterministic state transitions | `shared`, `scenarios` |
| `src/rendering` | PixiJS canvas and snapshot presentation | `shared` |
| `src/persistence` | Save validation, IndexedDB storage, and file portability | `simulation`, `shared` |
| `src/app` | React composition, controls, and orchestration | `simulation`, `rendering`, `shared` |

The browser application currently runs the simulation on the main thread through the typed command/snapshot interface. This keeps the initial scaffold small while preserving the seam that will move behind a Web Worker when simulation processing warrants it. The simulation test suite runs in a Node environment and does not construct browser, React, or PixiJS objects.

Millford Valley geography is generated from an authored scenario template plus
bounded seeded variation in `src/scenarios`. The simulation owns the generated
geography and includes it in its serializable snapshot; the renderer only applies
presentation styles to those snapshot features. A scenario seed therefore changes
geography without placing scenario coordinates or generation rules in PixiJS code.

Map camera and selection are presentation state. The PixiJS renderer derives hit
targets from snapshot geography, transforms one world container for pan and zoom,
draws the selected-feature highlight, and reports a small serializable selection
descriptor to the React inspector. Neither camera position nor transient selection
is written into authoritative simulation state.

Player road edits cross the same boundary as typed `build-road` and `remove-road`
commands. The simulation stores each player drag as an authored road segment and
derives a serializable road graph of nodes and links. The renderer owns only the
drag preview, screen-to-world conversion, and visual snapping before it submits a
command; it renders the resulting network snapshot rather than retaining road
connectivity itself. Highway upgrades also cross this boundary as typed commands
and rebuild the derived links from the upgraded authored segment.

For M0, graph construction checks every pair of authored segments, treats every
2D crossing as an at-grade intersection, and rebuilds the small graph after an
edit. Intersections split both affected segments into links that share one node.
Removing an authored segment then rebuilds the remaining topology, so links do not
become independent editing entities. Route queries run deterministic shortest-path
search using link generalized hours. Road class supplies link speed and practical
capacity; the latest lower-frequency assignment supplies congestion delay.

Bottleneck diagnosis is derived in the simulation from authoritative link flow,
capacity, cost, route, and assignment timing. The resulting serializable snapshot
is shared by the React inspector and a renderer-independent overlay mapper. PixiJS
only draws the affected-route and overloaded-link features; it does not decide
which road is constrained or why.

Collinear overlapping segments are rejected
because lanes, parallel links, bridges, tunnels, and junction configuration are
outside the issue's simple-road scope.

The M0 quarry freight assignment is a pure simulation-core calculation derived
from scenario terminals and the authoritative road graph. Its serializable
snapshot contains daily production, market demand, the selected route and cost,
shipped volume, and a limiting-factor explanation. React formats those values for
the quarry and market inspector but does not recalculate economic outcomes.

Representative freight vehicles remain renderer-owned. A pure rendering helper
validates the assigned route against the snapshot road graph, resolves its ordered
node geometry, and deterministically samples positions for the current animation
time. PixiJS reconciles only those short-lived graphics. A snapshot route or flow
change resets the visual plan, while disconnection clears it immediately; no
vehicle identity or animation phase crosses into the simulation protocol.

## Save format

Saves use an explicit versioned JSON document. Format version 3 contains the
Millford Valley scenario ID and seed plus the authoritative mutable state: the
simulation tick, authored road segments, the next road-segment number, completed
growth, pending construction, development evaluation counters, and current road
traffic assignment cadence and route. Derived geography, road nodes, and link
costs are rebuilt; the saved assigned route is validated against that topology
and reapplied so persistent congestion resumes identically. The freight snapshot
is then derived from the restored assignment.

Format versions 1 and 2 remain loadable. Roads without a class migrate to the
current default arterial profile, and a traffic assignment is derived at the
saved tick. Because version 1 contains no command history or development state,
it resumes at its saved tick with zero infrastructure-enabled growth and begins
evaluating from the next weekly boundary;
the loader does not invent past growth from the final road layout.

Imported data is structurally validated before it crosses into the simulation,
and restored road topology is checked against simulation invariants and scenario
bounds. An unsupported format version or scenario is rejected instead of being
loaded partially. Any future incompatible state or rule change must introduce a
new format version and an explicit migration path.

The browser UI exposes one named local save slot backed by IndexedDB. File export
serializes the same document as readable JSON for player-controlled backup and
portability; file import passes through the same validation and restore path as
the local slot. Camera, selection, construction-tool choice, and representative
vehicle animation remain presentation state and are not saved.

The M1 accessibility research scorer is also derived simulation state. Scenario
configuration supplies candidate locations and weighted market, labor, resource,
and service opportunities. The generic scorer depends only on shared serializable
types and the road route query; its results are included in simulation snapshots.
It maintains a per-candidate cache internally. Restoring a save deterministically
rebuilds the same accessibility values.

M1 settlement development is authoritative historical state layered on those
derived accessibility values. A pure growth reducer evaluates all candidates on
weekly tick boundaries, performs a seeded weighted selection, schedules delayed
construction, and applies gradual decline. Its serializable snapshot exposes
regional demand, location population and pressure, and pending work. React and
PixiJS only inspect or visualize that snapshot; neither chooses development.

Development decision explanations are derived alongside that snapshot in the
simulation core. Each location receives structured weighted contributions,
alternative comparisons, network-cost evidence, land cost, current selection
share, and the latest pending project's selected location. React formats those
values and labels the outcome but does not recalculate pressure or weighted
choice. The explanation is deliberately not persisted because its inputs are
already deterministically rebuilt from saved road and development state.

M2 road traffic state remains simulation-owned. Network edits trigger an immediate
assignment; time advancement processes fixed eight-tick boundaries even when the
caller advances many ticks at once. Each assignment routes quarry demand using
the previous link costs, replaces assigned link flows, and derives new congestion
costs. The accessibility scorer fingerprints generalized link cost as well as
topology, so only candidates whose routed opportunity costs changed receive new
score objects. PixiJS continues to animate representative vehicles every render
frame from the assigned freight snapshot and never updates congestion.

## M4 research evidence (2026-09-06)

The isolated [lane study](research/m4/README.md) now records causal priority and
spillback checks, representation-factor failures, units and named-machine movement
measurements. [ADR 0003](decisions/0003-m4-physical-traffic-reference.md) retains
weight 1 as the research reference. These are movement-only findings; production
traffic, renderer/camera and frame budgets remain undecided. The
[preliminary legacy inventory](research/m4/legacy-inventory.md) does not close #28
or supersede its dependency on the #26 presentation comparison.
