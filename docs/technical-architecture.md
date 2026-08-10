# Technical Architecture

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
connectivity itself.

For M0, graph construction checks every pair of authored segments, treats every
2D crossing as an at-grade intersection, and rebuilds the small graph after an
edit. Intersections split both affected segments into links that share one node.
Removing an authored segment then rebuilds the remaining topology, so links do not
become independent editing entities. Route queries run deterministic shortest-path
search using geometric link length. Collinear overlapping segments are rejected
because lanes, parallel links, bridges, tunnels, and junction configuration are
outside the issue's simple-road scope.

## Save format

Saved games contain a format version, seed, simulation time, world state, and scenario metadata. IndexedDB provides automatic local storage; explicit file export provides player-controlled backup and portability.
