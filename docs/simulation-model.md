# Simulation model

**Status 2026-09-26.** This is the authoritative specification of the M4 — Living Diorama
simulation core (`src/core`). **Implemented:** the lattice
([`src/core/lattice.ts`](../src/core/lattice.ts), 9 test cases in
[`lattice.test.ts`](../src/core/lattice.test.ts)) and, from D1, the integer utilities and
terrain (§1, §7), all guarded by the boundary test in
[`tests/architecture.test.ts`](../tests/architecture.test.ts). From D2 (2026-09-26, merged to
`main`): templates, pieces and keys (§5, §6), the validator for the D2-owned codes, clearance
and history (§9, §14), a first `derive` (§10) and the first `Sim` commands (§2). From D3
(2026-09-27, arriving with [PR #82](https://github.com/Kminkjan/infrastructurio/pull/82)): the
planner (§8). From D4's core half (2026-09-28, branch `codex/d4-structures-core`, not yet on
`main`): the grade, terrain/structure and vertical-clearance rules (§9) and auto-grade (§8).
Everything else here is planned. Its numbers come from the owner-approved M4 plan
(2026-09-26) and are proposed in
ADRs [0010](decisions/0010-triangular-lattice-track-geometry.md),
[0011](decisions/0011-signalling-and-reservation.md),
[0012](decisions/0012-tick-units-determinism.md) and
[0014](decisions/0014-autonomous-diorama-operator.md), all still Proposed. A number in this
file is a design target, not a measurement. Nothing here shows that a part is built, tuned
or accepted.

- **Player role.** The player only authors infrastructure through commands. Lines, train
  counts, depot choice and routes are all derived by the simulation. Nothing here gives the
  player lines, timetables, dispatch or fleet purchase.
- **Authority.** The simulation is authoritative and presentation-independent
  ([ADR 0002](decisions/0002-separate-simulation-from-presentation.md)). Module layout,
  boundary rules and the snapshot API live in [the architecture](architecture.md). Terms
  are defined in [the glossary](glossary.md).
- **Changes.** Change a number here only together with its ADR. Once the
  [acceptance gates](evidence/m4/2026-09-26-acceptance-gates.md) are predeclared, a number
  they depend on is never retuned after results.

Contents: [1 Status](#1-status-by-area) · [2 Interface](#2-interface) ·
[3 Units](#3-units-and-arithmetic) · [4 Lattice](#4-lattice-implemented) ·
[5 Pieces](#5-pieces) · [6 Keys](#6-keys-identity-and-elevation) ·
[7 Terrain](#7-terrain-implemented) · [8 Planner](#8-planner) · [9 Validation](#9-validation) ·
[10 Network](#10-derived-network) · [11 Signalling](#11-signalling-and-reservation) ·
[12 Movement](#12-movement) · [13 Operator](#13-m4-operator) ·
[14 Editing](#14-editing-while-running) ·
[15 Determinism](#15-determinism-and-replay-contract) · [16 Invariants](#16-invariants) ·
[17 Testing](#17-testing-strategy-and-golden-scenarios) · [18 Slices](#18-core-slices) ·
[19 Open points](#19-open-points-2026-09-26)

## 1. Status by area

Module paths are relative to `src/core/`. Tracking keys D1–D13 come from
[the backlog](backlog.md#tracking-keys) and are GitHub issues
[#65](https://github.com/Kminkjan/infrastructurio/issues/65)–[#77](https://github.com/Kminkjan/infrastructurio/issues/77).

| Area | Modules | Slice | Key | Status 2026-09-26 |
|---|---|---|---|---|
| Lattice | `lattice.ts` | S1 | D1 | **Implemented**, 9 test cases (map bounds live with terrain) |
| Integer helpers, PRNG, heap, hash | `util/` | S0 | D1 | **Implemented** in D1, 36 test cases |
| Terrain | `terrain.ts` | S3 | D1 | **Implemented** in D1, 20 test cases, golden hash (§7); generator version 2 in D11a, 23 test cases |
| Static diorama scenery | `scenarios/` | — | D11a | **Implemented** in D11a: seeded, integer-only layout for the lookdev spike (no sim behaviour), 21 test cases with a golden hash |
| Pieces and templates | `geometry/templates.ts`, `piece.ts`, `sample.ts` | S2 | D2 | **Implemented** in D2: 12 straights, 720 oriented curves, 24 shifts; closure and reachability tested ([ADR 0010 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-26-d2-track-model)) |
| Authored state, validation, clearance, history | `track/`, `geometry/clearance.ts` | S3 | D2, D4 | **Implemented** in D2 for the 11 D2-owned codes; D4's core half (2026-09-28, branch `codex/d4-structures-core`) adds the grade, terrain/structure (`track/structure.ts`) and vertical-clearance rules: 18 codes; the D4 thresholds of the owner decision "M2" (2026-09-28, branch `codex/d4-structures`): a ±8 m band, decks 2 m into the bank near abutments |
| Planner | `track/planner.ts` | S4 | D3, D4 | **Implemented** in D3 (2026-09-27, PR #82): one-bend, shift and two-bend fits (into ports, and as the fallback for free drags), magnetism, precision, elevation (pinned to existing node heights); 80 test cases in three files (§8). D4 (2026-09-28, same branch): heights within 35‰ and auto-grade (`Drag.heightMode`) |
| Derived network, entity commands | `network/derive.ts`, `graph.ts` | S5 | D2, D5–D7 | **Partial**: D2's `derive` (through and buffer nodes, sections split at buffers); junctions and entities planned |
| Pathfinding | `network/pathfind.ts` | S6 | D8 | Planned |
| Trains and movement | `trains/` | S7 | D8 | Planned |
| Reservation | `signals/reservation.ts` | S8 | D7, D8 | Planned |
| Deadlock and reasons | `signals/deadlock.ts`, `services/reasons.ts` | S9 | D9 | Planned |
| Operator | `services/operator.ts` | S10 | D9 | Planned |
| Editing while running | `sim/remap.ts` | S11a/b | D10 | Planned |
| Views, save, invariants, bench | `sim/` | S12 | D12 | Planned |

## 2. Interface

The full API is in [the architecture](architecture.md). The parts this model depends on:

```ts
createSim(scenario): Sim;  loadSim(save): Sim
Sim { tick; planTrack(drag): TrackPlan; preview(cmd): Result; execute(cmd): Result;
      step(ticks?); network(): NetworkView; frame(): FrameView; inspect(q): Inspection;
      save(): WorldSave }
Command = build-track{pieces: PieceSpec[], structure: ground|bridge|tunnel|auto}
        | demolish{pieces?, signals?, platforms?, depots?}
        | place-signal{node, facing, kind: stop|chain} | place-platform{pieces}
        | place-depot{node, facing} | undo | redo
Result  = {ok: true, networkRev, diff, counts{new, reused}}
        | {ok: false, reason{code, message, refs}, highlight}
```

- **Commands carry resolved pieces, not drag input.** Planner tuning therefore never breaks
  a replay.
- **`preview` shares the `execute` code path.** It does not mutate and consumes no IDs.
- **`NetworkView`** is cached per revision (`networkRev`). **`FrameView`** is produced every
  tick. The renderer interpolates `lerp(prevHeadMm, headMm, alpha)` along arc length and
  never extrapolates.

## 3. Units and arithmetic

| Quantity | Core unit | Notes |
|---|---|---|
| Length, position, distance | integer mm | Lattice step 5,000 mm (primary) or 8,660 mm (secondary) |
| Speed | integer mm/s | 60 km/h = 16,666 mm/s |
| Acceleration | integer mm/s² | Braking 600 planned, 900 capability |
| Time | tick = 100 ms (10 Hz) | Durations in ticks; path costs in integer ms |
| Elevation | integer mm per node | Terrain stored as Int16 dm, converted at its boundary (open point 2, settled as a default 2026-09-26) |
| Grade | ‰ | Maximum 35‰ |
| Direction | heading index 0–11 | 30° each, counter-clockwise from +x |

- **Integer helpers** (`util/int.ts`):
  - `isqrt(n)` takes `floor(Math.sqrt(n))` and corrects it by ±1 until r² ≤ n < (r+1)², so
    the result is exact whatever the engine's rounding;
  - `divFloor(a, b)` floors towards −∞ for negative numerators.
- **Magnitudes.** The largest intermediate in the tick step is about 1.2e9: 2·b·d with
  b = 600 mm/s² and the controller's distance clamped at 1,000,000 mm (§12). That is below
  2^31 and far inside the 2^53 exact-integer range of doubles. Terrain generation (§7, once
  per map, not per tick) reaches about 6.25e12 in its squared mm distances at the default
  size, still far below 2^53, and never uses bitwise ops on them.
- **No floats in the tick step.** Non-integer maths stays in construction and presentation
  paths:
  - `geometry/templates.ts` builds the template table once from `SQRT3`, `PI` and + − × ÷.
    It is the only place `PI` or `atan` appears.
  - `geometry/sample.ts` does render-only sampling.
  - `geometry/clearance.ts` makes the construction-time clearance decision (§9, rule 6).
  - `lattice.ts` converts world points (`toWorld`, `nearestNode`) for input snapping.

  Only the three `geometry/` modules may use trig, `pow`, `exp`, `log` or `hypot`. The
  boundary test enforces this.

## 4. Lattice (implemented)

- **Grid.** Triangular, spacing a = 5 m. Parallel primary rows are a·√3/2 = 4.330 m apart,
  which is the double-track spacing.
- **Coordinates.** Axial integers (q, r). World x = a(q + r/2), y = a·r·√3/2, in metres,
  math Y-up (x east, y north). The renderer maps this to Three.js through
  [`src/render/coords.ts`](../src/render/coords.ts) only.
- **Headings.** There are 12, at 30° intervals: heading 0 is +x, counting counter-clockwise.
  Even headings are primary (5 m steps). Odd headings are secondary (5√3 ≈ 8.660 m steps).
  Every step is an integer axial vector.

| h | Angle | Class | Axial step | World step (m) | `stepLengthMm` |
|---|---|---|---|---|---|
| 0 | 0° | primary | (1, 0) | (5.0, 0.0) | 5,000 |
| 1 | 30° | secondary | (1, 1) | (7.5, 4.330) | 8,660 |
| 2 | 60° | primary | (0, 1) | (2.5, 4.330) | 5,000 |
| 3 | 90° | secondary | (−1, 2) | (0.0, 8.660) | 8,660 |
| 4 | 120° | primary | (−1, 1) | (−2.5, 4.330) | 5,000 |
| 5 | 150° | secondary | (−2, 1) | (−7.5, 4.330) | 8,660 |
| 6 | 180° | primary | (−1, 0) | (−5.0, 0.0) | 5,000 |
| 7 | 210° | secondary | (−1, −1) | (−7.5, −4.330) | 8,660 |
| 8 | 240° | primary | (0, −1) | (−2.5, −4.330) | 5,000 |
| 9 | 270° | secondary | (1, −2) | (0.0, −8.660) | 8,660 |
| 10 | 300° | primary | (1, −1) | (2.5, −4.330) | 5,000 |
| 11 | 330° | secondary | (2, −1) | (7.5, −4.330) | 8,660 |

- **Symmetries.** Rotating 60° counter-clockwise maps (q, r) → (−r, q + r) and heading
  h → h + 2. Mirroring across the x-axis maps (q, r) → (q + r, −r) and h → 12 − h. The
  opposite of h is h + 6, with a negated step.
- **Parallel spacing.** Secondary parallel lines are only 2.5 m apart, which is too close
  for two tracks (rule 6 needs 4.0 m). Secondary double track therefore uses every second
  line, 5.0 m apart.
- **Map.** About 2.0 × 1.5 km, parametrised: 400 × 346 = 138,400 nodes by default (§7). The
  bounds belong to terrain and the scenario, not to `lattice.ts`.
- **What `lattice.ts` provides:** `stepOf`, `stepLengthMm`, `unit` (a √3 table, no trig),
  `opposite`, `rotateHeading`, `headingOfStep`, `add`, `rotate60`, `mirrorX`, `toWorld`,
  `nearestNode` (cube rounding) and `axialKey`, and it never returns −0.
- **What the tests cover:**
  - integer steps at h × 30°;
  - 5 m / 5√3 m lengths matching `stepLengthMm`;
  - the unit table;
  - rotation h → h + 2 and identity after six turns;
  - mirror h → 12 − h;
  - opposites;
  - no −0;
  - snapping, including jitter inside a node's cell;
  - `add`.

## 5. Pieces

A piece runs node to node on the lattice. There are three kinds; turnouts and diamonds are
derived, never authored.

### Straight

One lattice step: 5,000 mm on a primary heading, 8,660 mm on a secondary one. Longer
straight track is a chain of straights, so "N new, M reused" counts per step.

### Curve

A curve is a short straight lead-in, then a circular arc of radius R turning ±30°, ±60° or
±90°, then a lead-out. Both ends are tangent to lattice lines.
- **Radius classes.** The speed limit is √(0.8·R) m/s rounded to the nearest 5 km/h and
  capped at vmax. That rounding lifts 180 m from 43.2 to 45 km/h, which means about
  0.87 m/s² lateral instead of 0.8. The minimum radius is 60 m.

  | R (m) | √(0.8·R) | Limit | `speedLimitMms` | Arc length at 30° / 60° / 90° (m) |
  |---|---|---|---|---|
  | 60 | 6.93 m/s (24.9 km/h) | 25 km/h | 6,944 | 31.42 / 62.83 / 94.25 |
  | 90 | 8.49 m/s (30.5 km/h) | 30 km/h | 8,333 | 47.12 / 94.25 / 141.37 |
  | 120 | 9.80 m/s (35.3 km/h) | 35 km/h | 9,722 | 62.83 / 125.66 / 188.50 |
  | 180 | 12.00 m/s (43.2 km/h) | 45 km/h | 12,500 | 94.25 / 188.50 / 282.74 |
  | 240 | 13.86 m/s (49.9 km/h) | 50 km/h | 13,888 | 125.66 / 251.33 / 376.99 |
  | 360 | 16.97 m/s (61.1 km/h) | 60 km/h (vmax) | 16,666 | 188.50 / 376.99 / 565.49 |

  `speedLimitMms` = ⌊km/h × 1000 / 3.6⌋.
- **Exact closure without trig.** The tangent length R·tan(θ/2) is R(2 − √3), R/√3 or R for
  30°, 60° and 90°. Lead-in, lead-out and end node therefore need only `SQRT3`, and the arc
  length R·θ needs only `PI`. All piece lengths are rounded to integer mm from these.
- **Template closure.**
  - The number of variants that close exactly on the lattice is 1 for a 30° turn, 1 or 3
    for 60°, and 2 for 90°. Variants differ in lead-in/lead-out lengths.
  - That gives about 120 base templates (2 start-heading parities × left/right × 6 radii ×
    variants), × 6 rotations ≈ 720 oriented templates.
  - A design-pass check found every node in the reachable cone reachable. D2 turned that
    check into a repository test
    ([`templates.test.ts`](../src/core/geometry/templates.test.ts): 12,164 cone nodes, each
    reached exactly once; see the
    [ADR 0010 D2 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-26-d2-track-model)).

### Shift

Two reverse arcs of equal radius, with no straight between them, move the track sideways by
one row. Shifts build crossovers and passing loops.

| | Primary | Secondary |
|---|---|---|
| Axis headings | even | odd |
| Span along the axis | 37.5 m (7.5 steps) | 43.301 m (25√3; 5 steps) |
| Lateral offset | 4.330 m (one row) | 5.000 m (one secondary double-track spacing) |
| Axial displacement on the reference heading | h0: (7, 1) left, (8, −1) right | h1: (4, 6) left, (6, 4) right |
| Arc radius R = span / (2 sin α) | 47.5√3 ≈ 82.272 m | 95.000 m |
| Path length 2·R·α | ≈ 37.832 m | ≈ 43.685 m |
| Speed limit | 30 km/h (8,333 mm/s) | 30 km/h (8,333 mm/s) |
| Oriented templates | 12 (6 headings × 2 sides) | 12 |

- **Both kinds share one angle.** offset/span = √3/15 for both, so
  α = 2·atan(√3/15) ≈ 13.1736° (0.229921841 rad).
  - α is a checked literal. A test recomputes it with `Math.atan` at test time; runtime code
    never calls `atan`.
  - sin α = 2t/(1 + t²) = 5√3/38 with t = √3/15, so R needs no trig either.
- **Totals.** Curves and shifts together give ≈ 720 + 24 oriented templates.

### Turnouts and diamonds (derived)

- **Turnout.** A node is a turnout when one side has two pieces with the same outward
  heading: a straight plus a curve lead-in, or two curves. Side A has 1 port and side B at
  most 2. There is no turnout piece and no turnout command.
- **Fan.** The fan is the pieces of both legs from the switch node to where the legs are at
  least 4.0 m apart. Inside the fan, clearance is exempt and the sections share a conflict
  group (§10). A fan longer than 120 m is rejected.
- **Diamond.** A diamond sits only at a lattice node. Two axes each pass straight through:
  each axis is a pair of pieces with opposite headings, so the crossing angle is a multiple
  of 30°. A diamond node cannot also be a switch, and double slips are not supported.

## 6. Keys, identity and elevation

- **Canonical keys.** Pieces have geometric keys, not IDs:

  | Kind | Key | Fields |
  |---|---|---|
  | Straight | `S:q,r,z0:d:z1` | start node and z, heading, end z |
  | Curve | `C:q,r,z0:d:turn:R:variant:z1` | as above plus signed turn (left positive), radius class, variant |
  | Shift | `H:q,r,z0:d:side:z1` | as above plus side (left/right) |

- **Normalisation.** A key is written from the endpoint with the smaller (q, r, z), compared
  q, then r, then z. Writing a piece from its other end maps:
  - d → (d + 6) mod 12;
  - turn → −turn;
  - the variant to the one with lead-in and lead-out swapped;
  - z0 ↔ z1.

  A shift keeps its side when reversed. One physical piece therefore has exactly one key,
  and "N new, M reused" is a key lookup.
- **No geometry ID hazard.** Geometry is identified by key, so undo and redo cannot revive a
  stale ID.
  - Network IDs (sections, blocks, groups) are assigned by `derive` after sorting pieces by
    key, and are scoped to one revision.
  - Stations and trains come from monotonic allocators that never roll back. Undoing a
    platform and redoing it yields a new station ID, and so a new name.
- **Elevation.** z is integer mm per node (open point 2, settled as a default on
  2026-09-26), and node identity is (q, r, z). Tracks crossing
  at different heights over the same (q, r) are different nodes and never connect.
- **Grade.** The grade of a piece is |z1 − z0| over its length. The integer check is
  |Δz_mm| × 1,000 ≤ 35 × lengthMm; a piece stores its grade as that exact rational. The 35‰
  maximum lets a train always restart (§12). In mm a 5 m straight reaches 35‰ exactly
  (175 mm); dm allowed only 0, 20‰ or 40‰ (see [open point 2](#19-open-points-2026-09-26)).
- **Structure.** ground, bridge or tunnel is a piece property. The command may force it or
  pass `auto` (§9, rule 4).

## 7. Terrain (implemented)

**Status 2026-09-26 (automated, D1; version 2 from D11a; both
merged to `main`):** [`terrain.ts`](../src/core/terrain.ts) and its tests (23 since
D11a) are in place, with the golden hash `d2ee8189` for seed `"baltic-diorama"`
at 400 × 346 nodes (generator version 2; version 1 was `9a922d9c`). Findings:
[ADR 0010](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-26-d1-terrain)
and its [version 2 note](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-26-d11a-terrain-generator-version-2).
- **Layout.** One Int16 dm height per node in offset rows (row = r, col = q + ⌊r/2⌋), so
  the map is a rectangle from the south-west origin: even rows at x = 5·col m, odd rows
  2.5 m further east. `nodeOfOffset`, `offsetOfNode`, `heightDmAt`, `isWaterAt`,
  `terrainHash` and `terrainBoundsM` read it.
- **As built.** 200 dm base plus three value-noise octaves (420, 150 and 55 m cells, each
  grid rotated by an exact Pythagorean-triple angle and offset by the seed, version 2); a
  river 32 m wide and 1.8 m deep crossing west → east at about 46% of the map height, and a
  lake of 130 m radius, 2.5 m deep. Both beds rise to a shore shelf just above the water
  through a 10 m smoothstep ramp centred on the channel edge, so the waterline follows the
  curve rather than the lattice, then smoothstep banks rise to the natural terrain. Dry land
  stays ≥ water level + 0.5 m (water level 10 m): version 2 passes the coarse octaves through
  a C¹ rational soft floor and adds the finest octave back after it, where version 1
  clamped. River and lake positions scale
  with the map, so heights depend on `{seed, columns, rows, generatorVersion}`, not on the
  seed alone; the river and lake invariants hold from about 300 × 260 nodes up, and smaller
  maps leave the lake out rather than merge it into the river.
- **Flat plateaus (version 1) and their fix (version 2).** Version 1's clamp left 9.9% of the
  golden map exactly flat at 10.5 m (300-seed median 11.5%, worst 46.9%). Version 2 leaves
  0.21% at 10.5 m, and 0.28% of dry nodes with all six neighbours level (300-seed median
  0.31%, worst 0.86%). Whether the lowland now reads well is for the owner's look gate.
- **Generation.** Terrain is static and seeded. Heights come from integer hash value-noise
  evaluated at lattice nodes, stored as Int16 dm (±3,276.7 m), about 0.28 MB for the
  default map. A water mask adds a river and a lake. Noise corners are a pure hash of
  (seed, cell, octave), with no PRNG state; only the lake centre draws from the seeded PRNG.
- **One surface for sim and render.** The same heights form the low-poly render mesh.
  Between nodes, height is linear over the lattice triangle, so the simulation and the
  renderer agree on the surface.
- **Save.** Only `{seed, generatorVersion}` is saved; heights are regenerated on load.
  Open (D12): while the size is parametrised, a save must also carry `{columns, rows}`, or
  each generator version must fix them.
- **No terrain editing in M4.** Earthworks (embankments, cuttings, ballast skirts) are
  render-only. They never change the simulation's h.

## 8. Planner

`planTrack(drag)` is pure. It turns drag input into a `TrackPlan`: resolved `PieceSpec[]`,
new/reused counts and a label. `build-track` then carries those pieces.

**Status 2026-09-27 (automated, D3, PR #82):** implemented in
[`track/planner.ts`](../src/core/track/planner.ts), with 73 test cases in
[`planner.test.ts`](../src/core/track/planner.test.ts) (a 35-case drag table, ranking,
elevation, height-pinning and ground-following tests, a golden hash of the one-bend plans,
seeded properties, follow measurements, a probe on the diorama map and one-bend-a-node-off
tests against a brute-force single-bend oracle), a brute-force
two-bend oracle in [`planner.twoBend.test.ts`](../src/core/track/planner.twoBend.test.ts),
oracles for the free-drag two-bend fallback in
[`planner.twoBendFree.test.ts`](../src/core/track/planner.twoBendFree.test.ts), and planner
measurements in [`sim/perf.test.ts`](../src/core/sim/perf.test.ts). The choices this section
left open are under "As built" below; numbers and limits are in the
[ADR 0010 D3 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-27-d3-planner)
and, for two bends in one drag, the
[D3 two-bend finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-27-d3-two-bend-free-drags)
and the
[D3 one-bend-a-node-off finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-27-d3-one-bend-a-node-off).
Whether dragging feels right is not established: that is the owner's D3 feel check.

**Status 2026-09-28 (automated, D4 core half, branch `codex/d4-structures-core`):** heights
within 35‰ and auto-grade (owner decision 2026-09-28, "Auto-grade"), with their tests in
[`planner.grade.test.ts`](../src/core/track/planner.grade.test.ts); the design, the
alternatives measured and the numbers are in the
[ADR 0010 D4 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-28-d4-grades-and-structures).
Whether auto-grade feels right is the owner's to judge.

- **Single bend.** A drag becomes n straights + one curve or shift template + m straights.
  - For each of about 100 candidate templates on the start heading d0, the planner solves
    Δ = n·step(d0) + T + m·step(d1) as a 2×2 integer system for n, m ≥ 0.
    - Δ is the snapped end minus the start.
    - T is the template's axial displacement.
    - d1 = d0 + turn.
  - Candidates without an exact integer solution drop out. A collinear target needs
    straights only.
- **Selection order:** valid → largest radius under the user cap → shortest → smallest
  |turn| → left before right. This makes the choice fully deterministic.
- **Two-bend fit.** When the drag ends on an existing port, position and heading are both
  fixed. The planner then fits two bends with straights between them, to join the port.
- **Two bends in one drag** (owner decision, 2026-09-27, after the D3 feel check). When no
  single bend reaches a free drag's target, the planner fits two bends in the same drag,
  with the end heading free: straights + curve + straights + curve + straights, turning up
  to 180° in all (hairpins, U-turns, S-curves). A single bend still wins wherever one
  reaches, with the selection unchanged. Target, rank and precision rules are under
  "As built".
- **One bend a node off** (owner decision, 2026-09-27, "prefer one bend, a node off"):
  two bends only when no single bend lands on the target or one of its six neighbours. A
  single bend to a neighbour is smoother than two bends onto the target (which were
  mostly a small kink); the end then sits up to about 5 m from the pointer.
- **Magnetism.** The drag snaps to existing endpoints and ports within 3 nodes.
- **Elevation: track follows the ground within 35‰** (owner decisions 2026-09-27 for D3,
  and 2026-09-28 for D4: "Track follows the ground wherever it can within 35‰; the rest is
  absorbed by cuttings/embankments (±4 m) and, beyond that, automatic bridges and tunnels.
  The end may sit above or below the ground; the tooltip shows by how much."). The owner
  decision 2026-09-28 "M2" widened the band to ±8 m (§9). The start z comes from the snapped
  node; a free drag starting on water begins at the deck height, the water level + 4.0 m (M2;
  the track tool's anchor). `Drag.heightMode` (D4, additive, default "fixed") sets the end:
  - **"fixed"** (height steps pressed): the end z comes from the height keys, as steps above
    the ground at the end node; inner nodes follow the D3 profile, the ground (the terrain,
    or the water surface over a lower bed) plus an offset spread over the nodes by length
    with largest-remainder rounding between the heights of existing nodes the drag passes,
    fitted to 35‰ (below);
  - **"auto"** (no height steps, the tool's default): the planner also chooses the end, the
    ground there as far as 35‰ reaches from the start and the pins; inner nodes follow the
    ground within 35‰.

  Until 2026-09-27 the absolute height change was spread instead, so hills between the ends
  swallowed the track
  ([ADR 0010 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-27-d3-ground-following));
  until 2026-09-28 every node lay on the ground, about half the pieces of a diorama drag
  above 35‰.
- **Counter.** Keys already present count as reused, the rest as new. An all-reused drag is
  a no-op: `execute` changes nothing and records no history entry.
- **Precision mode** (Ctrl, or ⌥ on macOS):
  - magnetism off;
  - an explicit radius class (mouse wheel);
  - an explicit end heading (Q/E);
  - a live label such as "R 120 m · 35 km/h · 1.2%".

  It stays on the lattice. Off-lattice geometry and clothoids are deferred beyond M4.
- **As built (D3, 2026-09-27).** Defaults to test, not owner decisions:
  - **Candidates:** 51 on a primary d0 and 75 on a secondary one (one straight run, 48 or
    72 curves, 2 shifts), not "about 100". A shift fixes only n + m, so it is offered
    first (n = 0) and last (m = 0).
  - **Start heading d0:** `drag.fromHeading` when set. At an existing buffer end, whichever
    of continuing and retracing the track is nearer the drag direction. Otherwise the
    heading nearest the drag direction, ties to the lower index.
  - **Target node, in order:**
    - the pointer's nearest node N when a one-bend fit reaches it;
    - else one bend a node off: the neighbour of N nearest the pointer that a one-bend fit
      reaches, among N's six neighbours (5 m away, so the end lies under 7.64 m from the
      pointer; 3.0–5.6 m in the forward-cone cases this replaced). The nodes 8.66 m from N
      are left out, since they would put the end up to 11.5 m off. Distance ties go to the
      single-bend selection, and validity never moves the end to a farther neighbour. The
      halfway rule below applies, which only matters within about 15 m of the start;
    - else N when a two-bend fit reaches it.

    Otherwise, since no fit of one or two bends reaches inside the 60 m turning circles
    beside the start, or behind it within 120 m of its line: a pointer behind the start
    (fixed heading) takes the U-turn end nearest it, found exactly and at any distance;
    any other pointer takes the nearest node reachable with one or two bends that reaches
    at least halfway to it along the drag, by an exact ring search of up to 12 rings
    (about 52 m), and failing that the nearest U-turn end. The halfway rule keeps a
    pointer abeam inside a turning circle from getting a stub of straights ahead. A free
    drag is therefore empty only when it is too short; a precision end heading that no fit
    near the pointer can take still gives an empty plan with a `note`. Validity never moves
    the target, so an unbuildable drag still shows where it would go.
  - **Selection:** "fewer bends" comes before "largest radius", which changes nothing for
    single-bend pools. Remaining ties go to the earlier bend, then a canonical signature.
    Shifts keep their fixed radius and ignore the cap. Validity is checked lazily with
    structure `auto`, on at most 8 candidates in rank order; when none is valid, the
    top-ranked plan is returned for `preview` to explain.
  - **Ports and magnetism:** a port is an existing buffer end. Magnetism tries those within
    3 hex nodes of the pointer's node, nearest first. It skips `from` and any port that no
    fit reaches, and the end takes the port's height. Two-bend fits are curve + curve (any
    two turns summing to the heading change), or two shifts to one side (two rows).
    Without magnetism, a drag whose end node is a buffer end joins it the same way, unless
    precision fixes the end heading.
  - **Two bends in one drag:** at a target no single bend reaches, two-bend fits rank valid
    → largest smaller radius (under the cap) → total turn nearest the arc turn → shortest →
    smallest summed |turn| → left before right → earlier first bend. The arc turn is the
    turn of the one circular arc that leaves the start on its heading and passes through the
    pointer: twice the pointer's bearing, or 180° toward the pointer's side for a pointer
    abeam or behind, so those get U-turns whenever a U-turn is as wide as any other fit.
    Radius comes first as for one bend; shortest-first made every fit R 60. Only the best 8
    fits are kept, pruned by radius, and a tabled reach test serves the ring search
    ([ADR 0010 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-27-d3-two-bend-free-drags)).
  - **Precision:** curves only of the chosen radius class, both bends of a two-bend fit
    included. An end heading keeps only fits that end on it: one bend when one reaches the
    target, else one bend a node off (the same rule, with that radius class and end
    heading), else two (an S-curve back onto the start heading, a U-turn onto the opposite
    one).
  - **Elevation:** an intermediate node where existing track has a node within 6.5 m (the
    clearance height) of the plan's reference there takes that node's height, so a drag
    that retraces or extends sloped track reuses the pieces it overlaps. The reference is
    the ground plus the offset on the line, by length, from the last pinned node's offset
    to the end's (since 2026-09-27; before, the absolute height on that line). From 6.5 m
    on, the drag passes over or under and keeps its own height. With several heights in
    reach, a height whose incoming piece already exists wins, then one whose outgoing
    piece does, then the nearest, then the lower. Between pins (start, pinned nodes, end):
    largest remainder over the per-piece offset changes, weighted by piece length, ties to
    the earlier piece; each node is its ground plus its offset. A descent mirrors the climb
    ([ADR 0010 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-27-d3-height-pinning)).
  - **Ground following** (the rule is the owner's decision of 2026-09-27; these details are
    defaults): the ground is `groundMmAt` in [`terrain.ts`](../src/core/terrain.ts), which
    the app also gives the track tool, so a plan's ends and inner nodes agree. A node off
    the map takes the ground of the last on-map node before it on the path, else the first
    after it. On flat terrain the profile is the old one exactly. Limits, measured on the
    diorama map
    ([ADR 0010 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-27-d3-ground-following)):
    only nodes follow the ground, so a curve or shift, one piece with one grade (shifts
    43.7 m, curves a median 68 m and up to 200 m there), can still pass under a hill or over
    a hollow between its ends; and about half the pieces of a ground-following drag exceeded
    35‰, which D4's grade rule now rejects and its fit (next item) avoids.
  - **Heights within 35‰** (D4, 2026-09-28; defaults to test,
    [ADR 0010 D4 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-28-d4-grades-and-structures)):
    - fixed nodes: the start, the pins, and the end ("fixed", or a snapped port); a free
      "auto" end takes the ground at the end node clamped to what 35‰ reaches from the last
      fixed node (raised to clear water where reachable), or, with magnetism on, an existing
      node's height there within that reach and 6.5 m;
    - between consecutive fixed nodes: first the largest chain of nodes that lie exactly on
      the target (the ground in "auto", the D3 profile in "fixed") with each consecutive pair
      joinable within 35‰, then the least summed deviation Σ|z − t| in each gap, subject to
      35‰ per piece and to decks at the water level + 4.0 m or more beside water, exactly in
      integer mm (dynamic programming, a slope-trick pass);
    - two fixed heights 35‰ cannot join get a uniform ramp, which `preview` rejects as
      `grade-too-steep` with the length the climb needs;
    - where the target stays within 35‰ the heights are the target: on gentle ground a plan
      is the D3 profile exactly. On the diorama, 27.2% of auto-graded nodes lie on the ground
      and 76.4% of pieces sit at 30–35‰ (the terrain is steep); curves and shifts over mixed
      ground remain the main unbuildable case (§9).
  - **Malformed drags:** a non-integer start, non-finite pointer, or invalid heading or
    radius throws a `TypeError`. It is a programmer error, like a malformed command.

## 9. Validation

`preview` and `execute` share one validator.

**Status 2026-09-28 (automated, D4 core half, branch `codex/d4-structures-core`):** 18 codes
implemented: D2's 11 plus `grade-too-steep`, the five rule-4 codes and `vertical-clearance`,
each with a negative fixture in [`sim/fixtures.test.ts`](../src/core/sim/fixtures.test.ts);
rule 4 is in [`track/structure.ts`](../src/core/track/structure.ts). Entities (rule 7, D6/D7)
and the operational check (rule 8, D10) remain ordered placeholders that pass. **Since the
owner decision 2026-09-28 "M2"** (D4 integration, branch `codex/d4-structures`): the ground
band is ±8 m, and a bridge deck may sit up to 2 m below the terrain within 15 m of an abutment
([ADR 0010 M2 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-28-d4-thresholds-m2)).
- **Fixed rule order.** Rules run 1 → 8. The first failing rule returns ONE reason
  (`{code, message, refs}`) plus highlights. Messages suggest a fix.
- **Floats.** Clearance, and any arc sampling rule 4 needs, are the only float-based
  decisions. They are taken when a command runs, and the outcome is stored as authored
  state. Saves never re-validate.
- **Counts.** The catalogue below has **34 codes**. Each gets one negative unit fixture.

Notation: h is terrain height, z is track height, Δz is the height difference between two
tracks.

| Rule | Code | Rejected when | Message suggests |
|---|---|---|---|
| 1 Structural | `out-of-bounds` | a node or piece lies outside the map; also (D2) a malformed node or a node height beyond ±10 km | keep the track inside the map |
| | `limit-reached` | above 5,000 pieces, 512 signals, 32 stations or 8 depots | demolish unused items |
| | `unknown-target` | the command names a piece, node, signal, platform or depot that does not exist | refresh the target |
| 2 Geometry | `radius-too-tight` | radius below 60 m, or not a radius class | use R ≥ 60 m |
| | `turn-too-sharp` | more than 90° in one bend | split into two bends |
| | `no-fit` | no straights + template (or two-bend) combination closes on the lattice | move the end or change the end heading |
| 3 Grade | `grade-too-steep` | a piece above 35‰ | the length needed at 35‰ (e.g. a 6.5 m climb needs ≥ 186 m) |
| 4 Terrain and structure | `needs-bridge` | a ground piece more than 8 m above terrain (4 m until M2), or over water | use a bridge or lower the track |
| | `needs-tunnel` | a ground piece more than 8 m below terrain (h − z > 8 m; 4 m until M2) | use a tunnel or raise the track |
| | `bridge-below-ground` | a bridge deck below terrain: more than 2 m, or at all farther than 15 m along the track from an abutment (M2; any dip until then) | raise the deck or build on ground |
| | `bridge-too-low-over-water` | a deck below water level + 4.0 m | raise the deck |
| | `tunnel-too-shallow` | cover h − z < 6 m, except within 10 m of a portal | go deeper or build a cutting |
| 5 Node topology | `kinked-join` | pieces meet at a node without tangent continuity | adjust the end heading |
| | `turnout-too-many-legs` | more than 2 pieces on one side of a node | move one leg to another node |
| | `double-slip-unsupported` | a diamond node also has connecting legs | use a separate crossover |
| | `crossing-off-lattice` | two same-level pieces cross away from a node | cross at a node or on a bridge |
| | `diamond-with-junction` | a diamond node is also a switch | separate the diamond and the turnout |
| | `turnout-too-long` | a fan longer than 120 m | use a sharper diverging radius |
| 6 Clearance | `tracks-too-close` | two non-exempt centrelines closer than 4.0 m in plan while \|Δz\| < 6.5 m | move the tracks apart |
| | `vertical-clearance` | grade-separated tracks cross in plan with \|Δz\| < 6.5 m | raise or lower by the missing height |
| 7 Entities | `signal-not-on-plain-track` | the node is not a through node outside fans and diamond zones | move the signal to plain track |
| | `signal-exists` | a signal with that facing is already at the node | flip or remove it |
| | `platform-not-straight` | the pieces are not one collinear run of straights | pick a straight run |
| | `platform-length` | length outside 40–200 m | lengthen or shorten |
| | `platform-on-structure` | any piece is a bridge or tunnel | build on ground |
| | `platform-over-junction` | the run includes a switch, fan or diamond | move clear of the junction |
| | `no-room-for-platform` | the side is taken by another platform or track | use the other side |
| | `depot-not-at-track-end` | the node is not a buffer end, or the facing does not point into the stub | place at a dead end |
| | `depot-stub-too-short` | less than 50 m of plain stub behind the buffer | extend the stub |
| | `depot-exists` | the stub already has a depot | — |
| 8 Operational | `track-in-use` | the edit breaks a train's committed zone (§14); refs name the trains and pieces | wait or edit elsewhere |
| | `undo-empty` | nothing to undo | — |
| | `redo-empty` | nothing to redo | — |
| | `undo-blocked` | the undo/redo diff fails validation | clear the conflict first |

- **Rule 4 under `auto`.** Inference picks the structure for each piece first (the band ±8 m
  since the owner decision 2026-09-28 "M2", ±4 m until then):
  - ground when −8 m ≤ z − h ≤ +8 m and dry;
  - bridge when z − h > 8 m, or over water;
  - tunnel when h − z > 8 m.

  Then that structure's own rule applies. `needs-bridge` and `needs-tunnel` arise when
  ground is forced.
- **As built (D4, 2026-09-28; defaults to test,
  [ADR 0010 D4 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-28-d4-grades-and-structures)):**
  - **Grade:** an added piece fails when |num| > 35 · den on its exact rational grade. The
    message quotes the climb and the length it needs at 35‰, for the run of chained pieces
    rising (or falling) with the first steep one when the run is too steep as a whole, else
    for that piece.
  - **Samples:** track z is linear in arc length between the nodes, terrain h linear over
    each lattice triangle. Straights decide exactly at their nodes (and a secondary one also
    at the edge midpoint it crosses); curves and shifts are sampled every 0.5 m of arc. Over
    water, h is the bed; track at or above the bed is in or over the water, below it under
    the water.
  - **Inference:** in or over water: bridge; under water: tunnel; above and below the band
    both: the larger excess; else as the bullets above.
  - **Rules per structure:** ground needs a bridge above the band or in or over water, and a
    tunnel below the band or under water; a bridge's deck may not be below the terrain at any
    sample, nor under the water level + 4.0 m over water; a tunnel must go deeper than the
    band somewhere, and needs 6 m of cover beyond 10 m (along the track) of a portal, a
    tunnel node within the band (≤ 8 m of cover since M2, so the cover rule binds only between
    nodes).
  - **Abutments (M2):** a bridge node on dry land within the band. A deck may dip up to 2 m
    below the terrain within 15 m of one, measured along the track through the bridge's own
    pieces; elsewhere not at all.
  - Only added pieces are judged; a reused piece keeps its structure. The inferred
    structures are in the result's `diff.added`.
  - **Limits, measured** (1,682 auto-graded drags on the diorama, 72.8% accepted):
    `tunnel-too-shallow` 199 (open point 4), `bridge-too-low-over-water` 146 (starts on or
    near water), `bridge-below-ground` 74 (mostly single-grade curves over mixed ground).
    **Under M2** (1,690 drags, the same generator): 88.7% accepted, 95.3% of the 1,000 free
    drags; `bridge-too-low-over-water` 89 (mostly land too near the water to climb 4 m at
    35‰), `out-of-bounds` 32, `bridge-below-ground` 29, `tunnel-too-shallow` 18.
- **Rule 6 details.**
  - Exemptions: shared nodes, turnout fans and diamond arms.
  - Broadphase: an incremental spatial hash with 20 m cells.
  - Arcs are sampled with sagitta ≤ 0.05 m and distances padded by the same 0.05 m, so
    sampling error only ever makes the check stricter.
  - `vertical-clearance` replaces `tracks-too-close` where the centrelines cross in plan
    (D4: the closest chords lie within the pieces' arc pads). Its message gives the height
    missing to 6.5 m. A crossing or stacked track at 6.5 m or more passes, and a bridge over a
    line derives two plain nodes at the crossing, never a junction.
- **Trains and lines.** The 64-train and 16-line world limits are enforced by the operator
  (`capped-max`, `line-capped`). No command creates trains or lines.

## 10. Derived network

`derive(authored)` produces the `NetworkView`.
- **Pure and order-independent.** Pieces are sorted by key before any ID is assigned.
- **Cached per `networkRev`.** Each successful `execute` bumps the revision.
- **Contents.**
  - Pieces carry key, kind, structure, `lengthMm`, `z0Mm`/`z1Mm`, `speedLimitMms` and
    render primitives (lines and arcs).
  - Sections carry `blockId` and `conflictGroup`.
  - Also: junctions, signals, platforms, stations, depots.

- **Nodes and ports** (ports on side A, side B):
  - through (1, 1);
  - buffer (1, 0);
  - switch (1, 2);
  - diamond: two through axes.
- **Sections** are the reservation unit. They split at:
  - switches, diamonds and buffers;
  - signals;
  - platform ends and depot stub boundaries;
  - fan and diamond-zone boundaries.
- **Conflict groups.** Union-find over the sections in each turnout fan and each diamond
  zone. The two fans of a crossover share one group.
- **Directed sections and the one-way rule.** A train may pass a signal node in direction D
  only if a signal faces D, or no signal faces −D. So a single signal makes its node
  one-way, back-to-back signals allow both directions, and a node without signals allows
  both.
- **Reversal** is allowed only at platform stops and in depots.
- **Blocks** are the components left after cutting at signals. They drive overlays and
  explanations only, never reservation.
- **Platforms and stations.**
  - A platform is a straight run of 40–200 m. Its stop target is 3 m before the end in the
    direction of travel.
  - Platforms within 30 m laterally that overlap along the track group into one station.
  - Station names come from a Baltic place-name list indexed by the monotonic station ID.
- **Depots.**
  - A depot is a stub section of at least 50 m behind a buffer. 50 m is exactly the longest
    M4 consist.
  - Trains spawn and despawn on the stub and are stored off-network in between.
- **Pathfinding.**
  - Multi-target Dijkstra over states (directed section, canReverse). canReverse is true at
    a platform stop or in a depot.
  - Edge cost is the free-running time at the section's speed limit, in integer ms
    (⌈lengthMm × 1000 / limitMms⌉).
  - A reversal costs a 30 s (30,000 ms) penalty.
  - Ties break by (cost, dirSectionId).
  - It returns K candidates, one per platform of the target station, in preference order.

## 11. Signalling and reservation

- **Resources.**
  - Sections: holder = trainId, or −1 when free.
  - Conflict groups: holder plus a refcount (how many of the group's sections that train
    holds).
  - A section is grantable only if its group is free or already held by the same train.
- **Kinds.** Stop (block) signals and chain signals.
- **Request extent.** A request covers:
  - from a stop signal, a platform or a depot: sections up to the next signal of any kind,
    or to the destination;
  - from a chain signal: through further chain signals up to the next **stop** signal, or
    to the destination.

  Requests are all-or-nothing. A network without signals is one extent, so a single-track
  line runs one train safely.
- **Trigger.** A train requests when its distance to end of authority (EOA) is at most
  brakeDist(v) + 150 m. At 60 km/h that is 231 + 150 ≈ 381 m.
  - EOA is the end of the last held section, minus 3 m when that section ends at a signal.
  - At the destination, EOA is the stop target.
- **Arbitration.** FIFO. Each tick, requesters are sorted by (firstRequestTick, trainId),
  where firstRequestTick is when the train first asked for this extent.

  ```
  wanted := ∅
  for train in requesters sorted by (firstRequestTick, trainId):
    for cand in train.routeCandidates:           # one per platform, preference order
      need := resources(cand.extent)             # sections + conflict groups
      if every r in need is (free or held by train) and r ∉ wanted:
        grant(need); break
    if not granted:
      train.blockedBy := holders or earlier wanters of its first candidate's needs
      wanted := wanted ∪ need(first candidate)   # soft wants: this tick only
  ```

  - Trying candidates in order is how a train picks a free platform.
  - Soft wants block only later requesters, and only for that tick. A queued train can't be
    overtaken on the resources it waits for, so nothing starves.
- **Release.** After movement, sections behind the tail are released and group refcounts
  decremented. A group frees at refcount 0.
- **Aspects** (display only; trains obey holdings, not aspects):
  - a stop signal is green when its next section is free or held by the approaching train;
  - a chain signal shows partial when its first section is free but a later part of its
    extent is blocked.
- **Deadlock.**
  - Every 10 ticks, build the wait-for graph (train → its `blockedBy` trains) and run
    Tarjan SCC.
  - A cycle whose trains don't advance for 300 ticks (30 s) sets status `deadlock` and emits
    one event. The explanation names the trains, sections and signals, with a hint ("add a
    passing loop with signals").
  - At 1,200 ticks (120 s) the operator withdraws the highest-ID train in the cycle and logs
    it (§13).
  - Separately, a `waiting-long` flag is raised after 900 ticks (90 s) without progress,
    whatever the cause.
- **Negative fixtures salvaged from the road era** (re-implemented, never copied; see
  [the archive](archive/README.md)):
  - **Blocked exit:** a stop signal lets the tail foul the junction; a chain signal makes
    the train wait outside.
  - **Merge:** FIFO makes a merge alternate and keeps the wait bounded, where the old fixed
    priority starved one side.

## 12. Movement

- **Tick.** dt = 100 ms (10 Hz). All state is integer mm, mm/s and mm/s², using `isqrt` and
  `divFloor` (§3). There is no trig in the step.
- **Consist.** A tank locomotive (10 m) plus c coaches (9 m each, 1 m gaps), so the length
  is 10 + 10c m.
  - c = min(4, ⌊(shortest platform on the line − 15 m) / 10⌋), and at least 2.
  - Shortest platform 40–44 m → 2 coaches (30 m). 45–54 m → 3 (40 m). ≥ 55 m → 4 (50 m).
  - Stock is uniform per line in M4; mixed stock is deferred.

| Quantity | Value | Integer form |
|---|---|---|
| Max speed vmax | 60 km/h | 16,666 mm/s |
| Tractive acceleration a_t | 0.4 m/s² up to 36 km/h, then power-limited (≈ 4 W/kg) | min(400, ⌊4,000,000 / max(v, 1000)⌋) mm/s² |
| Grade | 9.81 mm/s² per ‰, weighted by the train's overlap with each piece | subtracted uphill, added downhill |
| Resistance | 20 mm/s², constant | |
| Braking | planned 600 mm/s², capability 900 | brakeDist(v) = ⌊v² / 1200⌋ mm |
| Braking distance from vmax | ≈ 231 m at 600 (≈ 154 m at 900) | |
| Balancing speed on 35‰ | ≈ 11.0 m/s (4,000,000 / 363.35) | golden scenario 6 accepts 10.5–11.5 m/s |
| Restart on 35‰ | 400 − 343 − 20 = +37 mm/s² net | the 35‰ cap keeps this positive (limit ≈ 38.7‰) |
| Level 0 → 36 km/h | ≈ 26 s at 380 mm/s² net | derived check |

The 2026-09-26 planning notes (not in the repository) wrote the tractive constant as 4e9.
With v in mm/s that value never binds, which contradicts the 11 m/s balancing speed. This
file uses 4e6 (see [open point 1](#19-open-points-2026-09-26)).

- **Controller.**
  - vLimNow = the minimum `speedLimitMms` over the pieces under the train's footprint, so a
    limit holds until the tail clears.
  - vAhead = the minimum, over upcoming limits Lᵢ starting dᵢ ≤ 300 m ahead of the head, of
    isqrt(Lᵢ² + 2·b·dᵢ).
  - vEOA = isqrt(2·b·min(max(0, EOA − head), 1,000,000)), with b = 600.
  - vAllowed = min(vmax, vLimNow, vAhead, vEOA).
  - Below vAllowed the train accelerates at a_t − grade − resistance, which can be negative
    on a climb. Above it the train brakes towards vAllowed, using at most the 900
    capability. The margin over the planned 600 absorbs tick quantisation.
- **Exact stop.** The head is clamped to min(EOA, stop target). At the target v = 0.
- **Proposed integration** (to settle in ADR 0012):
  - Δv = divFloor(a × 100, 1000) mm/s per tick;
  - head += divFloor((v + v′) × 100, 2000) mm (trapezoidal).
- **Dwell and reversal.**
  - Dwell is 20 s (200 ticks) at a platform.
  - A terminus reverses in place, bunker-first, with a 30 s (300 ticks) dwell. Head and tail
    swap and the footprint is unchanged.
  - Reversal elsewhere happens only at platform stops and in depots, priced by the 30 s
    path penalty.
- **Tick order:** commands → operator (on a network change plus a 50-tick debounce, or
  every 600 ticks) → reservation requests (FIFO) → movement (trainId order) → release and
  occupancy → arrival, dwell and reversal → deadlock scan (every 10 ticks) → invariants
  (every tick in tests, every 100 ticks in dev, off in production) → tick++.
  - Movement order doesn't matter, because authority is exclusive. A shuffle property test
    proves it.
- **Host loop** (in `src/app`, see [the architecture](architecture.md)):

  ```
  acc += dtWall × speed
  while acc ≥ 100 and n++ < 40: sim.step(); acc -= 100
  alpha = acc / 100
  ```

  - Speeds are 0, 1, 2, 4 and 10×.
  - The core never sees wall time.

## 13. M4 operator

One regional operator runs every service. It is a placeholder for the M5 operators
([ADR 0014](decisions/0014-autonomous-diorama-operator.md)). The player has no control
over it, only the inspector.
- **Headway.** The placeholder headway is 6 min (3,600 ticks). The inspector labels it a
  placeholder.
- **Cadence.** The operator runs on a network change plus a 50-tick (5 s) debounce, or every
  600 ticks (60 s).
- **Reachability** is computed from each depot exit.
- **Station adjacency.** Two stations are adjacent when routes exist in both directions and
  neither passes a third station's platform.
- **Lines** come from a chain decomposition of the station graph.
  - Stations with degree ≠ 2 are anchors, and anchor-to-anchor chains are shuttles.
  - An anchor-free cycle is a loop line if trains can circulate without reversing.
  - Line IDs are monotonic and matched by station sequence across re-derives. The maximum
    is 16.
- **Depot choice.** Each line uses the depot with the shortest travel time to its first
  station.
- **Train count.** The target is n* = ⌈round-trip time / headway⌉, with the round trip taken
  from path costs plus dwells. It is capped at 6 per line and 64 in total, and further by:
  - **Static passing bound.** A shuttle with no divergence gets 1 (`capped-no-passing`).
    Any other shuttle gets its passing places + 1. A loop gets max(1, waiting points − 1).
  - **Empirical growth.** A line starts with one train and adds one per clean round trip
    until it reaches the target.
    - A trip is clean when no train on the line raised `waiting-long` or `deadlock`
      (interpretation of `capped-waiting`). An unclean trip holds growth with
      `capped-waiting`.
  - **Deadlock backstop** (`capped-deadlock`). After a deadlock withdrawal the line keeps
    one train fewer. The cap resets when a construction diff touches the line's route.
- **Spawn** needs a free stub, a reservable exit extent, and 30 s (300 ticks) since that
  depot's last spawn.
- **Withdraw.** A train finishes its trip, then runs to a depot and despawns there. With no
  reachable depot it becomes `stranded` and is removed after 60 s (600 ticks).

**Reason catalogue** (inspectable; each carries refs to the entities involved):

| Entity | Code | Meaning |
|---|---|---|
| Station | `served` | at least one line calls here |
| | `not-connected-to-depot` | no depot exit reaches it |
| | `no-other-station-reachable` | reachable, but has no adjacent station |
| | `line-capped` | it would start a line, but the 16-line limit is reached (interpretation) |
| Line | `running` | at its current target |
| | `no-depot` | no depot reaches its first station |
| | `leg-unreachable` | a leg between consecutive stations has no route |
| | `capped-no-passing` | single track without passing places: 1 train |
| | `capped-deadlock` | backed off after a deadlock withdrawal |
| | `capped-waiting` | growth held after an unclean round trip |
| | `capped-max` | 6 per line or 64 in total reached |
| Train | `running` | moving at vAllowed |
| | `dwelling` | stopped at a platform |
| | `reversing` | terminus or depot reversal |
| | `waiting-signal` | a needed resource is held; refs name the signal, the blocking train and the section |
| | `queued-behind` | its resources are free but wanted by an earlier FIFO requester (interpretation) |
| | `slowed-curve` | a curve or shift limit binds |
| | `slowed-grade` | the grade holds it below vAllowed |
| | `deadlock` | in a detected wait-for cycle |
| | `no-route` | no path to any platform of its next station; stopped safely |
| | `withdrawing` | running to a depot |
| | `stranded` | withdrawing with no reachable depot |
| Section | `free` | no holder |
| | `reserved-by` | held by a train, not occupied |
| | `occupied-by` | under a train's footprint |
| | `one-way` | the one-way rule bars this direction |

- **Accounting.** spawned = active + despawned + withdrawn.
  - **despawned** means a train entered a depot normally.
  - **withdrawn** means a train was removed in place: a deadlock withdrawal or a stranded
    timeout.
- **Deferred to M5 or later:** demand, passengers, cargo, towns, money, mixed stock,
  operator-run timetables (autonomous; never player-set) and competition.

## 14. Editing while running

- **Committed zone.** For a moving train: from its tail to head + brakeDist(v) + 10 m. At
  60 km/h that reaches ≈ 241 m ahead. A stopped train commits only its footprint.
- **Acceptance.** An edit is accepted only if every committed zone still maps onto existing,
  connected pieces with exclusive holdings. Otherwise it fails with `track-in-use`, whose
  refs name the train IDs and pieces.
- **After a successful edit.**
  - Reservations beyond each zone are cut back and re-requested, and routes are re-planned.
  - A train with no route stops safely with `no-route`.
  - Planned approach for `sim/remap.ts`: trains hold positions as piece keys plus offsets.
    Keys survive the re-derive, so holdings can be re-expressed on the new revision's
    sections.
- **Undo/redo.** A stack of Diffs (added/removed) of depth 100. Each undo or redo is
  validated like any edit (`undo-blocked`). Trains, time, the operator and allocators are
  never in history.
- **Phasing.**
  - **S11a** rejects any edit that touches a held section.
  - **S11b** adds committed-zone truncation.

  S11a alone is safe, just stricter.

## 15. Determinism and replay contract

- **Banned in `src/core`:**
  - `Math.random`, `Date`, `performance`, `console`;
  - `window`/`document`/`globalThis`, timers, `structuredClone`;
  - `for…in`;
  - imports from outside core.

  Trig, `pow`, `exp`, `log` and `hypot` are allowed only in
  `geometry/{sample,clearance,templates}.ts`. The rules are enforced by `tsconfig.core.json`
  and [`tests/architecture.test.ts`](../tests/architecture.test.ts), which includes a
  negative self-check.
- **Ordering.** Every iteration that affects state runs in ID or key order. `derive` sorts
  pieces by key; trains move in trainId order.
- **Randomness.** `util/prng.ts` (sfc32) serves scenario generation and test generators
  only. The tick never draws a random number.
- **Hashes.** `util/hash.ts` computes FNV-1a over canonical JSON (sorted keys) of the world
  state. Checkpoint hashes are taken at tick 0, every 600 ticks and at the end of a run
  (ADR 0012; gate A4).
- **Replay equalities.**
  - step(1)×N == step(N) == step(10)×N/10;
  - save → load → continue == uninterrupted play;
  - the command log `(tick, cmd)` replays to identical checkpoint hashes.
- **Engine independence.** The sim step is engine-independent. Construction clearance is
  engine-pinned only at exact thresholds, because it is a float decision re-run when a
  logged command replays.
  - Recommendation: the replay harness asserts each command's recorded `ok`/`code`. A
    threshold divergence then fails loudly instead of drifting.
- **Save contents** (`WorldSave`):
  - `{seed, generatorVersion}`;
  - the authored pieces and entities;
  - allocators, trains, holdings, operator state and the tick;
  - the undo/redo stacks, because a log continuing after load may contain `undo`.

  The derived network is rebuilt on load, not stored. Saves never re-validate.
- **M4 persistence.** Replay fixtures only; there are no IndexedDB saves. Any later save
  must never use the legacy database `infrastructurio`.

## 16. Invariants

Checked every tick in tests, every 100 ticks in dev, and off in production:
1. **Exclusivity:** each section has at most one holder, and each conflict group at most
   one holder whose refcount equals its sections held in the group.
2. **Occupancy:** occupied ⊆ held; every section under a footprint is held by that train.
3. **Authority:** head ≤ EOA along the route.
4. **Speed:** speed ≤ the footprint limit (vLimNow, capped at vmax).
5. **Length:** each train's length stays constant (the tail is head − length along the
   path).
6. **Track:** no train stands on a missing piece.
7. **Accounting:** spawned = active + despawned + withdrawn.
8. **Holdings:** no orphan holdings; every holder is an active train.
9. **Network:** `derive(authored)` equals the cached network.

The safety soak in the gates counts 0 double-held sections, 0 signals passed at danger and
0 overlaps. Those counts are invariants 1–3 observed over time.

## 17. Testing strategy and golden scenarios

- **Unit.**
  - Lattice; templates closing on the lattice; integer lengths; planner cases.
  - One negative fixture per validation code (34, §9).
- **Property.** A small seeded forAll helper, with no new dependency:
  - `derive` is order-independent;
  - preview == execute, without mutation;
  - undo/redo round-trips;
  - shuffling the movement order keeps the hash;
  - random networks run 10k ticks with invariants checked every tick;
  - random edits during traffic keep the invariants.
- **Replay.** The three equalities in §15.
- **Golden scenarios** are built through commands only, so each doubles as a replay
  fixture. "Expected behaviour" follows from the rules above; exact assertions land with
  each scenario.

  | # | Scenario | Expected behaviour |
  |---|---|---|
  | 1 | Single-track shuttle | capped at 1 train, line reason `capped-no-passing` |
  | 2 | Passing loop | 2 trains, no deadlock over 2 simulated hours (72,000 ticks) |
  | 3 | Blocked exit, stop vs chain | stop signal: the tail fouls the junction; chain signal: the train waits outside |
  | 4 | FIFO at a junction | arrivals alternate; the wait stays bounded |
  | 5 | Diamond | never two trains in the diamond's conflict group |
  | 6 | Grade and curve speed profile | balancing speed 10.5–11.5 m/s on 35‰; curve limits held until the tail clears |
  | 7 | Edit while running | invariants hold; an edit inside a committed zone fails with `track-in-use` |
  | 8 | Loop line | trains circulate without reversing |
  | 9 | Unreachable station | station reason `not-connected-to-depot` or `no-other-station-reachable` |
  | 10 | Two-platform station | a second train takes the free platform |
  | 11 | Forced deadlock | detected ≤ 30 s, withdrawn at 120 s, then `capped-deadlock` |

- **Bench.** `vitest bench` on the `bench-m4` scene. Budgets are committed to
  `bench/budgets.json` before the first run.
  - Provisional sim budgets: tick p95 ≤ 0.5 ms, 10-tick batch p95 ≤ 3 ms, preview
    p95 ≤ 4 ms, commit p95 ≤ 25 ms.
  - The [acceptance gates](evidence/m4/2026-09-26-acceptance-gates.md) are authoritative:
    the safety soak (50 layouts × 10 simulated minutes) and determinism (3 fixtures × 1
    simulated hour).
  - Passing these tests is automated evidence only. It is not acceptance, and it is not the
    owner walkthrough.

## 18. Core slices

| Slice | Content | Key |
|---|---|---|
| S0 | skeleton, boundary test, `util/` | skeleton, D1 (`util/` **implemented** in D1, 2026-09-26) |
| S1 | lattice | D1 (**implemented**) |
| S2 | templates, piece, sample | D2 (**implemented** 2026-09-26) |
| S3 | terrain, authored, validate, clearance, history | D1 (terrain **implemented**), D2 (**implemented** for D2's codes, 2026-09-26), D4 |
| S4 | planner, paired with a Three.js ghost spike to judge feel | D3 (planner **implemented** in the core half, 2026-09-27; the ghost is the render half) |
| S5 | derive, graph, signal/platform/depot commands | D2 (first `derive`: through and buffer nodes), D5–D7 |
| S6 | pathfind | D8 |
| S7 | trains, one on a fixed route | D8 |
| S8 | reservation, multi-train | D7, D8 |
| S9 | deadlock + reasons | D9 |
| S10 | operator | D9 |
| S11a/b | remap: reject held sections, then committed-zone truncation | D10 |
| S12 | views, save, bench | D12 |

D8 depends on D12, so S12's invariants, save and hashes should land before S7–S8. Views and
bench budgets can follow. Only one agent at a time touches `core/track`, `core/signals` or
`core/trains`.

## 19. Open points (2026-09-26)

These were found while consolidating this document. The first three were checked by
arithmetic only, not by code. Each needs its ADR or slice to settle it; this file does not
decide them.

1. **Tractive constant.**
   - With a_t = min(400, ⌊K / max(v, 1000)⌋) and v in mm/s, the notes' K = 4e9 never binds.
     The train would then climb 35‰ at up to vmax.
   - K = 4e6 mm²/s³ gives the stated 11 m/s balancing speed and golden scenario 6.
   - Recommend ADR 0012 records 4e6.
2. **Grade quantisation.**
   - With z in integer dm, a 5 m straight holds only 0, 20‰ or 40‰. Primary straights
     therefore cap at 20‰ under a per-piece 35‰ rule.
   - Largest-remainder spreading at a steep average produces 40‰ pieces that then fail.
   - Recommend storing node z in integer mm, keeping terrain in Int16 dm:
     35‰ × 5,000 mm = 175 mm, exact.
   - Decide in ADR 0010 before S2.
   - **Settled as a default (2026-09-26):** node z is integer mm, per the
     [#66](https://github.com/Kminkjan/infrastructurio/issues/66) amendment and the
     [ADR 0010 D2 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-26-d2-track-model).
     ADR 0010 stays Proposed, so this is a default to test, not an owner decision.
3. **Downhill braking.**
   - On a 35‰ descent, the planned 600 mm/s² needs 600 + 343 − 20 = 923 mm/s² of brake,
     above the 900 capability. Net deceleration would be only 577.
   - Recommend D8 plans braking net of grade (b_eff = 600 − downhill share), so head ≤ EOA
     never relies on the clamp.
4. **Tunnel cover band.**
   - Ground allows at most 4 m of cutting, and a tunnel needs 6 m of cover beyond 10 m from
     a portal. Track 4–6 m below terrain is therefore buildable only near portals.
   - Recommend D4 checks with a fixture that ordinary seeded hills still admit a tunnel.
   - **Checked 2026-09-28 (automated, D4 core half):** they rarely do. Of 300 dry straight
     lines on the diorama that only a tunnel can take, the planner builds 3.3% and the
     deepest 35‰ profile 1.7%; the rest fail `tunnel-too-shallow`. From a portal at ≤ 4 m of
     cover, 6 m within 10 m needs the terrain to rise about 16.5% along the track, and only
     17.3% of the faces measured do. `tunnel-too-shallow` rejects 11.8% of auto-graded
     diorama drags. The thresholds are #68's; changing them is the owner's call
     ([ADR 0010 D4 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-28-d4-grades-and-structures)).
   - **Status 2026-09-28, after the owner decision "M2" (automated, D4 integration):** the owner
     widened the band to ±8 m and kept the 6 m cover and 10 m portal zone. Ordinary seeded hills
     now admit a tunnel: of 300 dry straight lines that only a tunnel can take at ±8 m, the
     planner and the deepest 35‰ profile each build all 300, and `tunnel-too-shallow` rejects
     1.1% of auto-graded diorama drags. With the band deeper than the cover, a node under less
     than 6 m is a portal itself, so the cover rule binds only between nodes
     ([ADR 0010 M2 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-28-d4-thresholds-m2)).
     #68's body still states ±4 m.
5. **Command gaps.**
   - `place-platform` carries no side, yet `no-room-for-platform` and island platforms
     imply one. Recommend adding `side: left | right | island`.
   - The station tool promises an editable name, but there is no rename command in M4.
   - The UX example "fits 6 coaches" exceeds the M4 consist cap of 4 (§12).

## Related documents

- [Architecture](architecture.md) — layout, boundaries, API and host loop
- [Prototype plan](prototype-plan.md) — the M4 contract and exclusions
- [Backlog](backlog.md) — D1–D13
- [Glossary](glossary.md)
- ADRs [0010](decisions/0010-triangular-lattice-track-geometry.md) (lattice geometry),
  [0011](decisions/0011-signalling-and-reservation.md) (signalling),
  [0012](decisions/0012-tick-units-determinism.md) (tick and determinism),
  [0014](decisions/0014-autonomous-diorama-operator.md) (operator)
- [M4 acceptance gates](evidence/m4/2026-09-26-acceptance-gates.md)
- [`src/core/CLAUDE.md`](../src/core/CLAUDE.md) — rules for working in the core
