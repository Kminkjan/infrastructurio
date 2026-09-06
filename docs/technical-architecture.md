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

Release validation keeps authored test orchestration outside the simulation
core. `src/testing/m3-release-fixture.ts` drives only the public command,
snapshot, and persistence interfaces, so it cannot bypass construction costs,
operator choice, objective state, or save validation. The matching portable
save exercises the same browser import path as a player file. Development builds
sample one bounded set of Pixi ticker deltas after each snapshot and expose the
summary as a canvas data attribute; the sampler is excluded from production by
the Vite development guard.

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

Rail uses a parallel but separate authoritative topology. Typed track and
terminal commands rebuild a rail-only graph; terminal IDs are compatible only
with the quarry, stoneworks, and market sites. Deterministic rail route queries
operate on terminal IDs and never traverse road links. Shared rail snapshots
carry authored track and terminal identity plus capacity, free-flow time,
construction cost, and maintenance. PixiJS derives track, terminal, hit-target,
selection, and construction-preview graphics from that snapshot and owns no rail
connectivity. Freight assignment consumes this rail graph through the separate
operator-choice layer.

The operator-choice layer owns one persisted assignment record for each
supply-chain leg. It queries road and rail independently, compares authoritative
generalized-cost components and capacity, selects one mode with stable
tie-breaking, and applies assigned aggregate tons back to road links, rail links,
and rail terminals. Infrastructure and price edits reassign immediately; time
advancement processes every crossed eight-tick boundary. Road link costs continue
to feed accessibility, while both modal networks expose the same flows used by
service explanations.

The M3 stone supply chain is a pure simulation-core reducer over bounded input
and output inventories. It advances once per simulated day in inbound,
processing, then outbound order. Its serializable snapshot contains both
aggregate freight legs, stoneworks activity and inventory, selected routes and
costs, shipped volumes, and limiting-factor explanations. React formats those
values for terminal inspectors but does not recalculate economic outcomes.

Infrastructure finance is a separate simulation-core reducer. Its shared cost
contract identifies an infrastructure kind and class and serializes base,
land-acquisition, crossing-work, salvage, and net values. The road evaluator
derives those values from normalized geometry and scenario constraints; a later
rail evaluator can emit the same contract without importing road rules. Quote
queries and edit commands call the same pure evaluators. Commands validate a
prospective topology before committing the network and finance state together,
so an invalid or unaffordable edit cannot partially mutate either system.

Daily finance transitions are interleaved immediately after the authoritative
stone-supply transition. They consume that day's delivered finished stone and
the current authored road network, then record bounded revenue, maintenance, and
the emergency-bond penalty. React displays the resulting snapshot and quote
breakdowns without calculating costs.

Scenario guidance is another simulation-core reducer. Selection sends typed
inspection intent, while the reducer alone decides whether that intent is
relevant and whether supply activation, bridge pressure, intervention, the
daily success hold, and completion occurred. Its snapshot includes objective
status, explicit subsystem cadence, success conditions, and the immutable ending
summary. React does not award progress or infer an intervention from UI actions.

Cross-system explanations are a derived simulation-core view rather than React
decision logic. They reference the authoritative subsystem snapshots and add
only identity, comparisons, units, and bounded causal structure. Consequence
forecasts run unchanged reducers against an isolated state copy with forecast
generation disabled, preventing recursive prediction and keeping live state
immutable. PixiJS maps explanation route links to distinct inbound/outbound
overlays; React presents the structured evidence and a persistent text equivalent.

Representative freight vehicles remain renderer-owned. A pure rendering helper
validates each assigned route against the matching road or rail graph, resolves its
ordered node geometry, and deterministically samples positions for the current
animation time. PixiJS reconciles only those short-lived graphics. Each leg has a
distinct visual identity namespace; a route or flow change resets its visual
plan, while disconnection clears it immediately. No vehicle identity or animation
phase crosses into the simulation protocol.

## Save format

Saves use an explicit versioned JSON document. Format version 9 contains the
Millford Valley scenario ID and seed plus the authoritative mutable state: the
simulation tick, authored roads and rail track, placed compatible freight
terminals, future road/track identifiers, development history, bounded stoneworks
inventories and daily update cadence, both current aggregate flow rates, and the
eight-hour multimodal assignment state, candidate comparison values, chosen mode,
and service-price adjustments for both legs. It also stores the treasury,
cumulative capital, revenue, maintenance and salvage totals, emergency-bond
state and penalties, the last committed infrastructure transaction, and scenario
inspection/progress history, daily success hold, and any completed ending
summary, plus the tick and two pre-edit accessibility totals for the latest
post-pressure strategic infrastructure transaction. Derived geography, road nodes, link costs, accessibility, current maintenance,
explanations, and presentation state are rebuilt. Rail graph nodes, links,
operational profiles, and infrastructure economics are also derived and rebuilt
from authored rail state.
Saved routes are validated against rebuilt topology and reapplied so congestion
and future supply-chain steps replay identically.

Format versions 1 through 8 remain loadable. Version 8 predates the retained
strategic-intervention accessibility baseline and restores that baseline as
absent rather than inventing a historical comparison. Version 7 predates authoritative
scenario objectives and starts fresh progress at its saved tick without inventing
past inspections, overloads, interventions, or successful hold days. Version 6
predates multimodal operator state; it retains rail topology but rebuilds private
assignment at the saved tick with zero price adjustments. Version 5 predates rail and migrates
to an empty rail network with the first track identifier available. Roads
without a class migrate to the current default arterial profile, and a traffic
assignment is derived at the saved tick. Version 3 represented the superseded direct quarry-export flow and
therefore cannot contain stoneworks history; migration starts the new stoneworks
dormant at the saved tick rather than inventing past inventory. Because version 1
contains no command history or development state,
it resumes at its saved tick with zero infrastructure-enabled growth and begins
evaluating from the next weekly boundary;
the loader does not invent past growth from the final road layout.
Version 4 contains the complete stone supply chain but predates finance history;
it starts with the current initial treasury at its saved tick and does not invent
past road spending, revenue, maintenance, salvage, or emergency support.

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

Freight operator state remains simulation-owned. Relevant infrastructure and
price edits trigger an immediate assignment; time advancement processes fixed
eight-tick boundaries even when the caller advances many ticks at once. Each
assignment independently compares road and rail for both supply-chain legs,
sums their rates on shared modal links, and derives new congestion costs. Daily
economy boundaries are interleaved with those
assignments deterministically. Realized processing adds a dynamic stoneworks labor
opportunity before development consumes the updated accessibility snapshot.
PixiJS continues to animate representative vehicles every render frame and never
updates congestion, inventories, or processing.
