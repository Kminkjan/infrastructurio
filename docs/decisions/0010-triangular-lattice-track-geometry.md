# 0010 — Triangular-lattice track geometry

- Status: Proposed
- Date: 2026-09-26
- Scope: Prototype. Track geometry and identity in the simulation core
  (`src/core/lattice.ts`, `src/core/geometry/`, `src/core/track/`, derived junctions in
  `src/core/network/derive.ts`), plus the construction ghost and precision mode in the
  tools and renderer
- Tracking: M4 epic "M4 — Epic: Living Diorama"
  ([#62](https://github.com/Kminkjan/infrastructurio/issues/62)); D1
  ([#65](https://github.com/Kminkjan/infrastructurio/issues/65)), D2
  ([#66](https://github.com/Kminkjan/infrastructurio/issues/66)), D3
  ([#67](https://github.com/Kminkjan/infrastructurio/issues/67)), D4
  ([#68](https://github.com/Kminkjan/infrastructurio/issues/68)), D5
  ([#69](https://github.com/Kminkjan/infrastructurio/issues/69))
- Evidence: [`src/core/lattice.ts`](../../src/core/lattice.ts) and its tests (automated);
  design-pass geometry, 2026-09-26 (not yet proved by tests)
- Decision authority: Pending (proposed 2026-09-26)
- Supersedes: None. Road-era
  [ADR 0005](https://github.com/Kminkjan/infrastructurio/blob/legacy-m0-m4/docs/decisions/0005-m4-grid-and-automatic-curves.md)
  (grid-assisted approaches and automatic curves) was Withdrawn, not superseded
- Superseded by: None

## Context

M4's first promise is satisfying track construction ([prototype plan](../prototype-plan.md)):
drag to lay curves, grades, bridges, tunnels, turnouts and stations, and see at once how many
pieces are new or reused and why a drag cannot be built. The same geometry feeds a
deterministic simulation ([ADR 0012](0012-tick-units-determinism.md)): lengths, speed limits
and clearances must be identical on every JavaScript engine, and replays must not depend on
how the planner interpreted a drag.

Rail needs gentle curves (radii of tens to hundreds of metres), parallel double track at a
fixed spacing, and junctions the player does not have to place as separate objects. The
owner's mood reference pairs lattice snapping with smooth curves and a precision mode; it is
a mood reference only ([art direction](../art-direction.md)), and the geometry below is this
project's own. The road-era construction proof used a square grid with Bézier curves, and
the salvage audit recommended re-implementing rather than porting it
([ADR 0008](0008-archive-road-era-and-restart.md)).

## Decision

Snap all M4 track to a triangular lattice and build it from a closed set of node-to-node
piece templates. Validation rules, reason codes and the planner in full live in
[the simulation model](../simulation-model.md).

1. **Lattice.** Triangular, spacing a = 5 m. Rows are a·√3/2 = 4.33 m apart, which is the
   double-track spacing. Nodes are axial (q, r); world x = a(q + r/2), y = a·r·√3/2 in
   metres, math Y-up. Twelve headings at 30°, counted counter-clockwise from +x:
   - even headings are primary, 5 m steps: d0 (1,0), d2 (0,1), d4 (−1,1), d6 (−1,0),
     d8 (0,−1), d10 (1,−1);
   - odd headings are secondary, 8.66 m steps: d1 (1,1), d3 (−1,2), d5 (−2,1), d7 (−1,−1),
     d9 (1,−2), d11 (2,−1).

   Rotating 60° maps (q, r) → (−r, q + r); mirroring across x maps (q, r) → (q + r, −r).
   Secondary parallel lines are only 2.5 m apart, so secondary double track uses 5 m. The
   map is about 2.0 × 1.5 km (parametrised).
2. **Pieces,** each from node to node:
   - **Straight:** one lattice step.
   - **Curve:** a short straight lead-in, a circular arc of radius R turning ±30°, ±60° or
     ±90°, and a lead-out, tangent to lattice lines at both ends. Variants that close on the
     lattice: 1 for 30°, 1 or 3 for 60°, 2 for 90°. About 120 base templates × 6 rotations
     ≈ 720 oriented templates.
   - **Radius classes,** with speed limits of √(0.8·R) m/s (about 0.8 m/s² lateral) rounded
     to the nearest 5 km/h. 60 m is the minimum radius, and 60 km/h is also the M4 train
     maximum:

     | R (m) | 60 | 90 | 120 | 180 | 240 | 360 |
     |---|---|---|---|---|---|---|
     | Limit (km/h) | 25 | 30 | 35 | 45 | 50 | 60 |

   - **Shift:** two reverse arcs that move the track one row, for crossovers and passing
     loops. Primary: 37.5 m long, 4.33 m offset, R ≈ 82.3 m. Secondary: 43.3 m long, 5.0 m
     offset, R = 95.0 m. Both turn α = 2·atan(√3/15) ≈ 13.174°, a checked literal that a
     test recomputes. Speed limit 30 km/h.
   - All lengths are integer millimetres, computed from `SQRT3` and `PI` with basic
     arithmetic. `src/core/geometry/templates.ts` is the only place π or atan appear.
3. **Turnouts are derived.** A turnout exists at any node where one side has two pieces with
   the same outward heading: side A has one port and side B at most two. The player lays
   track; there is no turnout piece. A third leg, a kinked join, a double slip or a fan
   longer than 120 m is rejected with its own reason code.
4. **Diamonds only at lattice nodes:** two axes cross at a node, each passing straight
   through. A diamond may not share its node with a junction, and a crossing away from a
   node is rejected.
5. **Canonical keys.** Every piece has a geometric key, normalised so the smaller end comes
   first: `S:q,r,z0:d:z1` (straight), `C:q,r,z0:d:turn:R:variant:z1` (curve) and
   `H:q,r,z0:d:side:z1` (shift).
   - "N new, M reused" is a key lookup; a drag whose pieces all exist is a no-op with no
     history entry.
   - Geometry carries no allocated IDs, so undo cannot create an ID hazard. `derive` sorts
     pieces by key before assigning network IDs, so the network does not depend on
     insertion order. Stations and trains use monotonic allocators that never roll back.
6. **Elevation and grade.** z is integer decimetres per node (integer millimetres as a
   default since 2026-09-26; see [Findings, D2](#findings-2026-09-26-d2-track-model)), and
   node identity is (q, r, z), so a track above another at the same (q, r) is a different
   node. Structure
   (ground, bridge, tunnel) is a piece property, inferred in Auto mode or forced by the
   Bridge and Tunnel tools. The maximum grade is 35‰, chosen so a train can always restart
   on it. The planner spreads elevation by length with largest-remainder rounding.
7. **Planner and precision mode.** A drag resolves to n straights + one curve or shift
   template + m straights, solved as a 2×2 integer system over about 100 candidates, and
   ranked: valid → largest radius under the user's cap → shortest → smallest |turn| → left
   before right. Two-bend fits join existing ports, and magnetism snaps within 3 nodes.
   - **Precision** (hold Ctrl, or ⌥ on macOS) turns magnetism off and takes an explicit
     radius class (mouse wheel) and end heading (Q/E), with a live label such as
     "R 120 m · 35 km/h · 1.2%". It stays **on the lattice**.
   - Commands carry resolved pieces, never drag input, so planner tuning never breaks
     replays.

Open: off-lattice geometry and transition curves (clothoids) are deferred beyond M4, and
the planner's feel is judged at D3. Node z resolution: integer dm quantises a 5 m primary
straight to 0, 20 or 40‰, so the 35‰ maximum is unreachable per piece and primary
straights cap at 20‰; decide dm vs integer-mm node z before S2
([simulation model open point 2](../simulation-model.md#19-open-points-2026-09-26))
(settled as a default 2026-09-26, integer mm; see [Findings, D2](#findings-2026-09-26-d2-track-model)).

## Alternatives considered

- **Square grid** (the road-era construction proof). Its eight headings turn in coarse 45°
  steps, and only four directions share one parallel spacing: with 5 m cells, orthogonal
  rows one cell apart are 5 m apart but diagonal rows 3.54 m. The triangular lattice turns
  in 30° steps, gives all six primary directions the same 4.33 m row spacing (already a
  double-track spacing), and has the 60° symmetry the camera yaw uses
  ([ADR 0009](0009-render-isometric-threejs.md)).
- **Freeform Bézier curves with free placement.** The most freedom, but cubic Béziers with
  chord/3 handles do not hold a constant radius, so keeping their tightest point above rail
  minimum radii needs roughly 4.5× the space of a circular arc (a design-pass estimate; the
  factor varies with the turn angle and was not re-measured here). Speed limits would vary
  along each curve. Free placement also gives up exact closure, integer lengths and
  canonical keys, and with them reliable new/reused counts, undo without ID hazards,
  node-based junction and diamond derivation, and engine-independent clearance. The target
  feel (snapping, smooth curves, fine control) does not need it: precision mode and chained
  drags supply fine control on the lattice.

## Consequences

- **Benefits.** Every template closes exactly, so snapping, reuse counting, junction
  derivation and clearance are exact and deterministic. The 60° rotation multiplies the
  template set by six at no design cost. Keys make undo safe and the network
  order-independent. Speed limits are template properties, known before any train runs.
- **Costs.** The vocabulary is finite: six radii, 30° steps and one-row shifts. Curves have
  no transition spirals, so curvature jumps at arc ends (a speed and visual matter only).
  Secondary-heading double track needs 5 m, not 4.33 m. Precision mode is not free-form.
- **Risk.** Planner feel may fall short of a continuous follow. Mitigations: the D3 owner
  feel check, chained drags, an auto-waypoint fallback, and a template table that is cheap
  to extend.
- **Follow-up.** D1 finishes the lattice; D2 builds templates, pieces, validation,
  clearance and history; D3 the planner, ghost and precision mode; D4 grades, bridges and
  tunnels; D5 turnouts and diamonds. M6 roads are expected to reuse the lattice with lane
  presets.

## Validation and acceptance boundaries

Evidence on 2026-09-26:
- Automated: [`src/core/lattice.test.ts`](../../src/core/lattice.test.ts) covers the
  integer step per heading, 5 m and 5√3 m step lengths with matching millimetres, the unit
  table, 60° rotation (h → h + 2, identity after six turns), mirroring (h → 12 − h),
  opposite headings, no negative zero, and snapping world points back to their node. This
  ADR did not re-run it.
- Agent arithmetic, for this ADR: the shift radii and α and the rounded radius-class
  limits recompute from the formulas above.
- Design pass, not yet a test: every template closes on the lattice with tangent continuity,
  and every node in the reachable cone is reachable.

Still to prove: template closure and reachability by test, and one negative fixture per
reason code (D2); planner drag cases and new/reused counts (D3); `preview` p95 ≤ 4 ms in
performance gate B ([acceptance gates](../evidence/m4/2026-09-26-acceptance-gates.md)); and
the **D3 owner feel check**, which is human only. Nothing here claims that construction
feels right.

## Findings (2026-09-26, D1 terrain)

Recorded while implementing D1's core lane on branch `codex/d1-lattice-terrain`
([`src/core/terrain.ts`](../../src/core/terrain.ts) and
[`terrain.test.ts`](../../src/core/terrain.test.ts)). Automated evidence only, Node 26.7.0
on macOS; the status of this ADR stays Proposed.
- **The lattice needed no change for terrain.** `toWorld` places every terrain node and
  `lattice.test.ts` (9 tests) passes unchanged on the branch.
- **Terrain lives at lattice nodes in an offset-row layout.** Row = r, col = q + ⌊r/2⌋, one
  Int16 dm height and one water flag per node, row-major. The axial rhombus becomes a
  rectangle with its south-west node at the origin: even rows at x = 5·col m, odd rows
  2.5 m further east, rows 4.33 m apart. Sim and renderer read the same node heights.
- **The default map is 400 × 346 nodes** (138,400; 1997.5 × 1493.9 m; heights 0.28 MB),
  replacing the "≈ 401 × 347" design estimate. The size stays a parameter.
- **Generation is integer-only.** Each node's position is converted once to mm
  (x = 2500·(2q + r) exactly, y = round(r · 4330.127…)); after that there is only integer
  arithmetic: `hash32` value noise, 1024-scaled smoothstep, squared mm distances with
  `isqrt` for the river and lake banks, and `divFloor` for every division. The largest
  intermediate is a squared distance of about 6.25e12 at the default size, far below 2^53. No
  transcendental `Math` and no floats accumulate, so the heights are engine-independent.
- **Banks ramp through the waterline.** The first cut jumped from the bed straight to the
  shore shelf at the channel edge: 2.3–3.4 m across one 5 m edge on every one of the golden
  map's 2,091 shore edges, so the 10 m waterline crossed each at 70–80% of its length and
  traced the lattice instead of the curve. A 10 m smoothstep ramp centred on the channel
  edge now joins bed and shelf. The water edge moves out about 1.7 m (river) and 2.2 m
  (lake). On the four test seeds no shore edge climbs more than 22 dm and crossings spread
  over the whole edge (at most 18% of them in any tenth of it); on the golden map the
  steepest triangle drops from 37.0° to 32.9°. A test holds the climb and spread. Version 1
  had not shipped, so it stays 1 with a re-recorded hash.
- **Measured (after the ramp):** golden terrain hash `9a922d9c` for seed `"baltic-diorama"`
  at the default size; 5,850 water nodes (4.23%); heights 75–402 dm; generation took a
  median of 59.2 ms over 10 runs (58.8–60.1 ms) on this machine, which is a dev
  measurement, not a gate result. On four seeds the tests find exactly one river touching
  both the west and east edges, exactly one lake (2,200–2,700 nodes, clear of the edges)
  and no other water. A 300-seed probe (`s0`–`s299`) found the same on every seed, with
  lakes of 2,527–2,541 nodes and 4.20–4.55% water.
- **Consequences for later slices.** River and lake positions scale with the map size, so
  heights depend on `{seed, columns, rows, generatorVersion}`: a save must also carry the
  size, or each generator version must fix it (D12). The river and lake invariants hold
  from about 300 × 260 nodes up (40 seeds per size). On smaller maps the lake is left out
  when no candidate clears the river (the first cut merged it into the river instead, 21 of
  40 seeds at 160 × 139), and around 100 × 87 the river can leave through the north or
  south edge.
- **The land clamp leaves flat plateaus, heavily on some seeds.** Clamping dry land to
  water level + 0.5 m leaves 9.9% of the golden map's nodes exactly flat at 10.5 m. Over the
  300-seed probe the share has a median of 11.5% and a 90th percentile of 21.1%; 5 seeds
  pass 30% and the worst (`s80`) reaches 46.9%. M4 uses only the golden seed. Whether the
  flats read as meadow or as a defect is for the owner's look gate, not this note; if they
  are a defect, a continuous integer soft floor above 10.5 m would keep some relief.
- **Not established:** that the terrain looks right, that the render mesh matches these
  heights (the render lane's tests), or how grade, bridge and tunnel rules fare on this
  relief (D4).

## Findings (2026-09-26, D11a terrain generator version 2)

Recorded on branch `codex/d11a-lookdev` ([#75](https://github.com/Kminkjan/infrastructurio/issues/75)).
Automated evidence only (Vitest, Node 26.7.0 on macOS); the status of this ADR stays Proposed.
D1 left two look issues for the owner: value-noise banding along x and y at Far zoom, and the
flat plateaus above. Version 1 had not shipped in a save, so D11a bumped
`TERRAIN_GENERATOR_VERSION` to 2 rather than patching version 1.
- **Rotated, offset octaves.** Each octave's grid is rotated by a Pythagorean-triple rotation
  (cos, sin) = (a/c, b/c) — 16.3° (7-24-25), 43.6° (20-21-29) and 75.8° (16-63-65) — and
  shifted by a seeded offset. Integer mm stay exact up to one floor per axis, so there is still
  no trigonometry. A square grid repeats every 90° and the lattice every 30°, so each angle
  sits 13.6–15.8° from both, and the three are 27–32° apart modulo 90°: no two octaves share
  cell edges and none lines up with the lattice or the screen at a rest yaw. Corner values hash
  absolute cell indices. A test holds the triples and the angle spread.
- **A soft floor instead of the clamp.** The two coarse octaves pass through a C¹ rational
  soft floor, n for n ≥ 17.2 m and F + k²/(k + (K − n)) below it (F = 12.7 m, k = 4.5 m), then
  the finest octave (±2.2 m, 55 m cells) is added back at full strength. Land still never dips
  below 10.5 m, so no random ponds, but lowland keeps rolling relief instead of lying flat.
- **Measured:** golden hash `d2ee8189` (version 1 was `9a922d9c`); 4.23% water; heights
  75–396 dm; steepest triangle 33.4° (was 32.9°); 0.21% of dry nodes sit exactly at 10.5 m
  (was 9.9%) and 0.28% have all six neighbours at the same height. Over the 300-seed probe
  (`s0`–`s299`) that six-neighbour flat share has a median of 0.31%, a 90th percentile of
  0.52% and a worst seed of 0.86%, and every seed still has exactly one west–east river and
  one lake (2,527–2,541 nodes; 4.20–4.55% water). Generation took about 103 ms in one dev run
  (was a median of 59 ms): the rotation adds divisions. A dev measurement, not a gate result.
- **Not established:** that the banding is gone at Far or that the lowland reads well; both
  are for the owner's Look Gate A.

## Findings (2026-09-26, D2 track model)

Recorded while implementing D2's core lane on branch `codex/d2-track-model`
([`src/core/geometry/`](../../src/core/geometry/), [`src/core/track/`](../../src/core/track/),
[`src/core/network/derive.ts`](../../src/core/network/derive.ts) and
[`src/core/sim/`](../../src/core/sim/), with their tests). Automated evidence only, Node 26.7.0
on macOS (Apple M5 Pro); the status of this ADR stays Proposed.
- **Node z is integer millimetres** (open point 2, settled as a default by the
  [#66](https://github.com/Kminkjan/infrastructurio/issues/66) amendment of 2026-09-26, to test
  rather than an owner decision). Keys, `NodeRef` and the network view carry `zMm`; terrain stays
  Int16 dm and converts at its boundary. 35‰ over a 5 m straight is exactly 175 mm. A piece
  stores its grade as the exact rational (z1 − z0)·1000 / `lengthMm` ‰, so D4's 35‰ rule can
  compare integers.
- **Template counts, exact:** 12 straights; 120 base curves (start headings 0 and 1) and 720
  oriented curves, 48 per primary start heading and 72 per secondary one; 24 shifts (12 primary,
  12 secondary). Curves are generated for left turns on headings 0 and 1, mirrored for right
  turns, then rotated five times; the generator rebuilds every oriented template's primitives
  from the unit table and throws unless they land on the node the rotated axial offset names.
- **Why 1 / 1 or 3 / 2 variants.** A curve ends at A·u0 + B·u1 with A, B ≥ T (the tangent
  length). Adding a straight moves A or B by one step, so one template is needed per class of
  the cone modulo the straight-step lattice: |det(step(d0), step(d1))| of them, which is 1 for
  30°, 1 (primary) or 3 (secondary) for 60° and 2 for 90°. Variants are the nodes of the cell
  T ≤ A < T + |s0|, T ≤ B < T + |s1|, numbered by length, so describing a curve from its other
  end keeps its variant index (the generator throws if two variants ever tied). Every
  secondary 60° variant 0 is a pure arc with no lead-in or lead-out: T = R/√3 = (R/15)·5√3
  is a whole number of secondary steps (R/15 = 4, 6, 8, 12, 16, 24), so A = B = T already
  lands on a node.
- **Tests now prove the design-pass claims:** every oriented template closes on its node with
  start, joint and end tangents within 1e-9 rad; `lengthMm` = round(float length × 1000) for
  every template; and each of 12,164 nodes in the cones of all 432 curve families (windowed to
  four straights past the cell) is reached by exactly one variant plus non-negative straights.
  Shifts measure 37,832 mm (R 82,272 mm) and 43,685 mm (R 95,000 mm), both 8,333 mm/s; the α
  literal 0.22992184100141289 matches 2·atan(√3/15) within 1e-15. The integer template table
  hashes to `5565e541`, held by a golden test.
- **Key format.** `S:q,r,z0:d:z1`, `C:q,r,z0:d:turn:R:variant:z1`, `H:q,r,z0:d:side:z1` with
  z in mm and side `left` or `right`, written from the end with the smaller (q, r, z). Parsing
  accepts only canonical integers (no leading zeros, no `-0`), so parse and format are exact
  inverses. `demolish` also accepts a key written from the other end.
- **Topology choice (D2).** A node holds one piece (buffer) or two with opposite outward
  headings (through). Everything else is rejected as `kinked-join`, the only D2 topology code:
  a kink, a second piece on the same side (a turnout, which D5 turns into a legal node), and
  three or more pieces. The messages tell the three cases apart. No clearer D2 code exists in
  the catalogue; `turnout-too-many-legs` belongs to D5 and means more than two on one side.
- **Clearance choices.** Arcs are sampled with sagitta ≤ 0.05 m and each piece containing an
  arc pads the threshold by 0.05 m, so two curves are judged up to 0.1 m stricter than exact.
  Heights compare as the gap between the two chords' height ranges, also conservative. Only
  pieces sharing a node with the same (q, r, z) are exempt, so stacked track over one (q, r) is
  `tracks-too-close` while |Δz| < 6.5 m until D4 adds `vertical-clearance`. The reason names
  the first new piece (in command order) that clashes and its closest partner, ties going to
  the smaller key: the distance comes from that pair alone, so the reason never depends on
  insertion order, and the quoted distance is that piece's worst clash (a crossing reads
  0.00 m, not a smaller-keyed neighbour's 2.50 m).
- **Other rule choices.** `out-of-bounds` covers malformed nodes (non-integer q, r or z), end
  nodes off the map, and a centreline leaving `terrainBoundsM` while both nodes are on the map
  (a test finds such a curve at the east edge). An unknown kind, an invalid heading or a zero
  turn is `no-fit`. `limit-reached` counts specs that do not resolve as new, so it can win over
  a geometry reason at the cap. `auto` resolves to ground until D4 infers structures, and a
  reused key keeps its existing structure (whether a structure change is an edit is for D4).
  Node heights must lie within ±10 km (`Z_LIMIT_MM` = 10,000,000 mm), or the spec is
  `out-of-bounds`: far outside terrain's Int16 dm range (±3,276.7 m), and it keeps the grade
  numerator Δz·1000 at most 2e10, so the rational stays exact. A command's shape (its
  `type`, a build's `structure`, the `pieces` arrays) is a programmer contract and throws a
  `TypeError`; only its contents (specs and keys) are player-reachable, and those are
  rejected with a reason, never thrown.
- **`undo-blocked` is not reachable from commands in D2.** Every track change goes through
  history, so sequential undo and redo always restore a state that was valid. Its fixture
  starts from a loaded world whose redo diff no longer fits (the path a save takes, since loads
  never re-validate) and triggers it with `redo`; trains make it reachable in D10.
- **Performance, a dev measurement and not a gate.** These numbers come from one run of an
  uncommitted dev probe, so the repository does not reproduce them: the committed smoke
  ([`sim/perf.test.ts`](../../src/core/sim/perf.test.ts)) times the same preview but asserts
  only that the median of 7 runs is under 20 ms, and never times execute, undo or
  `network()`. Previewing a 100-piece build over 4,900 existing pieces (to the 5,000 cap, so
  every rule runs) took a median of 0.37 ms over 30 runs (max 0.81 ms); a 10-piece execute
  and its undo took 0.44 and 0.43 ms; the first `network()` at 4,900 pieces took 13.6 ms. A
  100-piece build over 5,000 existing pieces stops at `limit-reached` and times almost
  nothing. The gate numbers are D12's.
- **Not established:** planner feel and new/reused counting from drags (D3), grade, structure
  and vertical clearance (D4), turnouts and diamonds (D5), any behaviour under traffic (D10), or
  that clearance decisions at exact thresholds match across JavaScript engines.

## Findings (2026-09-27, D3 planner)

Recorded while implementing D3's core half on branch `codex/d3-planner`
([#67](https://github.com/Kminkjan/infrastructurio/issues/67);
[`src/core/track/planner.ts`](../../src/core/track/planner.ts) and
[`planner.test.ts`](../../src/core/track/planner.test.ts)). Automated evidence only, Vitest
4.1.10, Node 26.7.0 on macOS (Apple M5 Pro); the status of this ADR stays Proposed.
- **Decision 7 needed no template change.** The planner reads the D2 template table as it
  is. Every solve is exact integer arithmetic on axial offsets, and a plan is the
  `PieceSpec[]` that `build-track` carries. The contract types from commit `0dd6e90`
  (`Drag`, `TrackPlan`, `PlanFit`, `PlanPointMm`) are unchanged.
- **Candidates, exact:** 51 per primary start heading and 75 per secondary one (one
  straight run, 48 or 72 curves, 2 shifts), not "about 100". A shift fixes only n + m, so
  it is offered first and last. Two-bend fits (into ports only) are curve + curve, with any
  two turns summing to the heading change, or two shifts to one side (two rows). For each
  template pair the non-negative solutions lie on one line with period |det| ≤ 3, and the
  length is affine along it, so the shortest comes in closed form.
- **Choices this ADR left open** (defaults to test; the full list is in the
  [simulation model §8, "As built"](../simulation-model.md#8-planner)):
  - **Start heading d0:** the drag's own when set. At an existing buffer end, the nearer of
    continuing and retracing: forcing the continuation made dragging back over existing
    track (reuse) impossible. Otherwise the heading nearest the drag direction.
  - **Target:** the pointer's nearest node when some candidate reaches it, so the plan
    ends under the snap ring. Otherwise the nearest reachable node, by an exact ring search
    of up to 12 rings (about 52 m). Otherwise an empty plan with a note.
  - **Selection:** validity is checked lazily, on at most 8 candidates in rank order, with
    structure `auto`. "Fewer bends" comes before "largest radius"; that changes nothing
    for single-bend pools and ranks two-bend fits last. Ties then go to the earlier bend,
    then a canonical signature. Shifts keep their fixed 82.3 m or 95 m radius and ignore
    the cap.
  - **Magnetism:** tries buffer ends within 3 hex nodes of the pointer's node, nearest
    first. It skips `from` and any port that no one- or two-bend fit reaches. The end takes
    the port's height and must arrive on the port's heading.
- **Validity never moves the target.** Hopping to a valid node elsewhere would pull the
  end away from the pointer and hide the reason. Instead the plan follows the pointer and
  `preview` explains. Example (a unit test): an S-bend 12 rows over needs at least
  32 q-steps. With 30 left, magnetism skips the port, the free plan ends on the port's node
  at 30°, and preview rejects it as `kinked-join`.
- **Follow, measured** (not the feel). Pointers were within ±60° of the start heading at
  40–200 m, 425 per start mode (`planner.test.ts`, `--reporter=verbose`):

  | Start heading | End on the pointer's node | Median | p95 | Max |
  |---|---|---|---|---|
  | 0 (fixed) | 81.2% | 2.00 m | 20.12 m | 30.41 m |
  | 1 (fixed) | 76.7% | 2.00 m | 20.63 m | 30.06 m |
  | free | 91.1% | 1.77 m | 3.40 m | 4.37 m |

  With a fixed heading, the misses lie inside the 60 m minimum-radius turning circle,
  which one bend cannot reach. As the pointer crosses into reach, the end can jump more
  than 10 m: an uncommitted probe stepping the pointer 1 m at a time found 36 such jumps
  among 1,468 end moves (heading 0).
- **Selection in practice** (an uncommitted probe over every target within ±60 nodes for
  free ends and ±30 nodes for ports). For free ends, radius, length and bend placement
  decided between the top two candidates. For ports, bends, radius, length, placement and
  the signature decided (the signature: two variants swapped at equal length). |turn| and
  left before right never decided the top two, so a direct comparator test holds them.
- **Performance, a dev measurement and not a gate.** One run of
  [`sim/perf.test.ts`](../../src/core/sim/perf.test.ts) with `--reporter=verbose`, over
  4,900 existing pieces on the default map:
  - `planTrack`, 184 fixed drags × 3 passes: median 0.086 ms, p95 0.450 ms, max 1.193 ms
    (n = 552);
  - `preview` of the planned pieces: median 0.030 ms, p95 0.105 ms, max 0.647 ms
    (n = 528);
  - the worst case the validation cap allows (every candidate validated, at most 8, of a
    plan over 100 pieces rejected by clearance): median 1.755 ms, p95 2.395 ms, max
    2.731 ms (n = 40).

  Magnetism scans every node of the track index on each call (about 5,000 at the piece
  cap), with no cache. The gate numbers are D12's (preview p95 ≤ 4 ms, gate B3).
- **Not established:**
  - that dragging feels right (the owner's D3 feel check, human only);
  - the ghost, tool and tooltip integration (the render half);
  - how D4's grade and terrain rules change which candidates are valid (today "valid"
    covers D2's rules, and `auto` resolves to ground);
  - joining at turnouts (D5);
  - timings on the gate hardware, or agreement across JavaScript engines.

## Findings (2026-09-27, D3 height pinning)

Recorded on branch `codex/d3-construction-tool`
([#82](https://github.com/Kminkjan/infrastructurio/pull/82);
[#67](https://github.com/Kminkjan/infrastructurio/issues/67)). Automated evidence only,
Vitest 4.1.10, Node 26.7.0 on macOS 26.6.2 (Apple M5 Pro); the status of this ADR stays
Proposed.
- **Defect.** The planner split a drag's height change over the whole path. Where the drag
  overlapped sloped existing track, the shared inner nodes came out millimetres off the
  existing heights. Node identity includes z, so the overlapping pieces missed their keys,
  and the plan was rejected (`kinked-join` or `tracks-too-close`) instead of reusing them.
  Endpoint-to-endpoint reuse already worked: the start is the existing node, and the tool
  snaps the end height.
- **Rule (a default to test).** Walking from the start, an inner node where the authored
  track has nodes takes one of their heights. It must lie within 6.5 m (the clearance
  height) of the line, by length, from the last pinned node to the end.
  - Nearer than that the plan would clash anyway. From 6.5 m on it passes over or under
    (a grade separation) and keeps its own height; 6.5 m exactly counts as clear, as in
    the clearance rule.
  - Between consecutive pins (start, pinned nodes, end) the rise is split by length with
    largest remainder, as before.
  - The start and end heights, `Drag` and `TrackPlan` are unchanged.
- **Several heights at one (q, r)** (a bridge over track, possible from D4). First wins:
  the height whose incoming piece, from a pinned previous node, already exists; then one
  whose outgoing piece, to an existing height at the next node or the end, already exists;
  then the nearest to the line; then the lower. Only the authored heights and the path
  decide, so the choice does not depend on build order.
- **Index.** The track index now keeps the committed node heights per (q, r)
  incrementally (`heightsAt` in [`track/validate.ts`](../../src/core/track/validate.ts)).
  The planner looks up piece keys only when two or more heights are in reach.
- **Tests (automated).**
  - Eight new planner tests: a sloped extension (8 reused, 3 new), a partial retrace from
    outside the run (6 reused, 4 new), the split between pins, the 6.5 m boundary, both
    multi-height rules, build order with undo and redo, and a seeded property. In 150 runs
    the property saw 65 retraces of random sloped chains, 52 of them extending the chain,
    all at the chain's heights. There is also one index test.
  - The seven sloped cases and both seeded properties on existing track (level and sloped)
    fail on the previous planner.
- **Performance, a dev measurement and not a gate.** Three runs each of
  [`sim/perf.test.ts`](../../src/core/sim/perf.test.ts) before and after, on the same
  machine. The two ranges overlap:
  - `planTrack` median: 0.083–0.085 ms before, 0.084–0.088 ms after;
  - worst-case median: 1.720–1.912 ms before, 1.749–1.972 ms after.
- **Not established:**
  - the feel of dragging over existing track (the owner's D3 feel check);
  - D4's grade rule. A pin can make the pieces beside it steeper than the drag's average,
    and D4 will reject pieces over 35‰;
  - a later pin moving an earlier node. The line runs to the end because the next pin is
    not yet known on the walk. A later pin can therefore move an unpinned node's final
    height back within 6.5 m of existing track, where it clashes. No test builds that case;
  - multi-height layouts beyond the constructed tests. D3 builds them only as level track
    6.5 m or more above other track (`auto` resolves to ground).

## Findings (2026-09-27, D3 review: the two-bend solve)

Recorded after the code review of [#82](https://github.com/Kminkjan/infrastructurio/pull/82);
automated evidence only. It corrects the D3 planner section's two-bend sentence, which stays
as written above.
- **The period divides |det|; it is not |det| itself.** For each template pair the
  non-negative solutions lie on one line, and the length is affine along it, so the shortest
  fit sits at one end of the feasible interval. The first version stepped by |det| and could
  miss that end. With three secondary headings (for example 1 → 3 → 5) every step is
  feasible, so some 60° + 60° joins came out up to two straights (17.3 m) longer than the
  shortest: D = 5a + 5c gave (2, 3, 2), 7 steps, instead of (0, 5, 0).
- **Now:** `solveThree` scans at most |det| values inward from each end of the feasible
  interval. A brute-force oracle over every turn pair (8,378 solvable cases,
  [`planner.twoBend.test.ts`](../../src/core/track/planner.twoBend.test.ts)) checks the
  shortest fit; it also caught the 1 → 11 → 9 triple.
- **Not established:** whether the shorter joins change how port joins feel; that is the
  owner's check.

## Findings (2026-09-27, D3 ground following)

Recorded on branch `codex/d3-construction-tool`
([#82](https://github.com/Kminkjan/infrastructurio/pull/82);
[#67](https://github.com/Kminkjan/infrastructurio/issues/67)). Measurements are automated
evidence only, Vitest 4.1.10, Node 26.7.0 on macOS 26.6.2 (Apple M5 Pro). The status of this
ADR stays Proposed: the owner decision below sets D3's height rule, and it accepts no ADR.
- **Owner decision (2026-09-27, as relayed to the implementing agent).** In D3, track
  follows the ground. It sits on the terrain at every node, and `[` `]` still raise or lower
  it. The 35‰ grade rule, earthworks, bridges and tunnels come in D4, which will revisit
  this. Following the ground exceeds 35‰ on this terrain, which is accepted for D3 because
  validation has no grade rule yet.
- **Defect.** The tool set only the end heights from the ground, and the planner spread the
  height change linearly between pins, so hills between the ends swallowed the track.
  - Probe on the diorama map (seed `"baltic-diorama"`, 400 × 346 nodes, generator version
    2): 2,000 random straight drags of 10–40 steps on all 12 headings, both ends on the
    ground, starts at least 300 m inside the map, PRNG seed `ground-probe`.
  - Before, over 52,267 nodes: 24.1% lay more than 1 m and 9.5% more than 3 m below the
    ground, and 23.1% more than 1 m above it. 45.6% of drags dipped more than 1 m, and the
    worst node lay 24.8 m under.
  - That agrees with the figures relayed with the decision (24%, 9%, 43% of drags, worst
    14 m; their seed is not recorded here).
- **Rule.** Each node's height is the ground there plus an offset. The mechanism follows
  the decision; the details are defaults to test.
  - The ground is `groundMmAt` in [`terrain.ts`](../../src/core/terrain.ts), exported
    through `sim/api`: the terrain height (dm × 100), or the water surface where it lies
    above a water node's bed. The app gives the track tool the same function, so a plan's
    ends and inner nodes agree, over water too.
  - The planner interpolates the offset, not the absolute height, between pins (the start,
    the existing-node height pins, the end) by cumulative length, with largest-remainder
    rounding as before. With both ends on the ground and no pin, every node lies on it; a
    raised end ramps the offset from the start's to the end's.
  - Height pinning keeps its 6.5 m rule. The reference is now the ground plus the offset on
    the line from the last pin to the end, so overlaps with existing track are still
    reused. A node off the map takes the ground of the nearest on-map node along the path.
  - `Drag`, `TrackPlan`, commands and keys are unchanged, and no field was added. `dzMm`
    still fixes only the end (`from.zMm + dzMm`, or a snapped port's height). No optional
    linear profile was kept: nothing in D3 uses it, and D4 reopens the profile anyway.
  - On flat terrain the profile is exactly the old one. All the flat-map drag cases,
    height-pinning cases and properties pass unchanged.
- **After (automated).**
  - The same probe finds all 52,267 nodes exactly on the ground: none below, none above.
  - 50.5% of its 50,267 pieces exceed 35‰, against 38.3% on the old, smoother but
    underground profile.
  - A committed probe in [`planner.test.ts`](../../src/core/track/planner.test.ts) plans 400
    straight and free drags with zero height steps, re-planning the end onto the ground as
    the tool does. All 6,882 of their nodes lie on the ground, and 50.0% of 6,526 pieces
    exceed 35‰.
- **Tests.**
  - Five new planner tests:
    - a drag over a ridge on the ground at every node;
    - the offset ramped by a raised end and down from a raised start;
    - existing-node pins on hilly ground, reused, with the offset ramped between pins;
    - a seeded property on rolling hills, which pinned in 15 of 150 runs when written;
    - the diorama probe.
  - One `groundMmAt` test, one render-lift ordering test, and the render-lift measurement
    below as an annotated dev test with loose guards.
  - The property helper now checks ground plus offset, which equals the old check on flat
    maps.
  - Changed because they assumed linear interiors on seeded terrain:
    - the contract test now starts and ends on the ground, and its label reads the
      steepest ground piece (10.0%);
    - the track tool test's `flat` session now runs a flat sim. It used to report flat
      ground over seeded terrain that the planner now follows.
  - The track picker tests now aim with the exported `PICK_LIFT_M`.
- **Limit: pieces carry one grade each, so only nodes follow the ground.** A curve or shift
  is a single piece, so its interior still runs straight in height between its two end
  nodes (§6 grade).
  - In the render measurement below, curves were a median 68 m long, up to 200 m. 13.8% of
    curve centreline samples lay more than 1 m under the terrain (worst 14.6 m), and 11.8%
    more than 1 m above it.
  - Shifts (43.7 m) had 1.2% more than 1 m under and 2.0% more than 1 m above.
  - Before the change, curve samples had 23.6% under and 21.4% above.
  - No render lift can hide this. D4's earthworks (render-only cuttings and embankments), or
    a different way for curves to carry height, would have to.
- **Render lift (visual only; sim heights untouched).** How it was measured, in
  [`render/track/trackLift.test.ts`](../../src/render/track/trackLift.test.ts). The suite
  runs it at 300 plans; the numbers here are from the same code at `PLANS = 3000`:
  - 3,000 plans with zero height steps, as the tool makes them: half straight drags of
    10–40 steps, half free drags within ±150 m, ends re-planned onto the ground. That gave
    53,871 pieces.
  - Each piece's rendered centreline (the track meshes' own sampling) was resampled every
    0.25 m.
  - At each sample, the visible surface was compared with the track height. The surface is
    the LOD0 lattice-triangle terrain, or the water plane where that is higher. The
    comparison ran across the track at u = 0, ±0.817 m (rails), ±1.3 m (ghost ribbon edge),
    ±1.6 m (ballast top edge) and ±2.2 m (shoulder base).
  - On straights, where node following applies, the centreline never dips under the
    surface on primary headings, and at most 0.29 m on secondary ones. At the rails the
    terrain rises above the track height by at most 0.39 / 0.41 m at p99.9 (primary /
    secondary), and by at most 0.52 / 0.57 m overall.

  | Lift | Rail-top samples buried (primary / secondary) | Ballast-top edge buried | Gap > 5 cm under the shoulder (floating) |
  |---|---|---|---|
  | 0.05 m (before) | 0.271% / 0.262% | 28.4% / 27.9% | 3.1% / 3.3% |
  | 0.10 m | 0.070% / 0.124% | 13.6% / 14.0% | 3.8% / 4.1% |
  | **0.15 m (chosen)** | **0.007% / 0.055%** | **6.4% / 8.0%** | **5.2% / 5.6%** |
  | 0.20 m | 0.002% / 0.018% | 4.1% / 4.6% | 8.1% / 8.3% |
  | 0.25 m | 0.000% / 0.001% | 2.9% / 3.3% | 13.6% / 12.8% |

  - **Chosen: 0.15 m** (`TRACK_LIFT_M` in
    [`render/track/trackGeometry.ts`](../../src/render/track/trackGeometry.ts)), which puts
    the rail tops at 0.45 m.
    - It is the knee of the table. 0.02% (primary) and 0.18% (secondary) of straight pieces
      keep any buried rail-top sample, against 0.63% and 0.77% at 0.05 m.
    - Ballast-top edges still sink where the terrain slopes up across the track, which reads
      as track cut into a hillside.
    - On flat ground the 0.35 m ballast keeps its shoulders 0.2 m below the surface. Gaps
      open only on the downhill side of cross slopes. 0.20 m would add little for the rails
      and float more.
  - **No depth bias.** A polygon offset shifts depth by far less than decimetres here. Big
    enough to matter, it would also draw track over terrain that really hides it.
  - **Derived lifts,** which keep overlays and picking on the drawn rails:
    - The ghost ribbon moves from 0.4 m to 0.5 m, 5 cm over the rail tops, so a reused
      (cyan) piece still shows over built track. The ribbon edge is hidden on 0.51% /
      0.42% of straight samples, against 1.10% at 0.4 m.
    - The snap ring stays at 0.6 m, now derived as the ribbon + 0.1 m.
    - The track picker aims 0.4 m up (0.3 m before), still 5 cm under the rail tops, so
      nodes and centrelines pick where they are drawn.
    - The terrain ray march and the snap ring's node anchoring read sim heights and are
      unchanged. A test holds the order ballast top < pick aim < rail tops < ribbon < ring.
  - **Whole population, curves included:** 4.6% of rail-top samples are buried at 0.15 m
    and 5.4% at 0.05 m. With the old profile at 0.05 m it was 36.5%.
  - **Ghost marks:** zero-step plans that show drop lines and end-height tags fell from
    1,525 to 348 of 3,000. Those that remain are curves more than 0.5 m over a hollow;
    straights never float more than 0.41 m between nodes.
  - The ghost's drop lines and tags now measure from the water surface over water (in
    `src/app/main.ts`), as the tool's ground does.
- **Agent browser check (Playwright captures in headless Chrome, same machine; agent
  evidence, not the owner's feel check or a Look Gate).**
  - A 30-piece straight was dragged with the real pointer across a hill 7.1 m above its
    higher end. Built, it lies on the ground at 6, 14 and 24 ppm, and at yaw 0° and 60°. The
    rails show along its whole length, with no gap visible under the ballast.
  - The tooltip read "Grade 34.0 %" (red) for its steepest piece, which is truthful.
  - In the D3 manual capture set, the reused ribbon still draws over built track, and the
    elevated ghost's tags and drop lines still draw.
- **Performance, a dev measurement and not a gate.** Three runs each of
  [`sim/perf.test.ts`](../../src/core/sim/perf.test.ts):
  - `planTrack` median: 0.087–0.090 ms before, 0.088–0.092 ms after;
  - worst-case median: 1.845–1.903 ms before, 2.033–2.263 ms after (about +10%, one terrain
    lookup per node per candidate profile).
- **Not established:**
  - whether ground-following track feels or looks right: that is the owner's D3 feel
    check, and the look is for the Look Gates;
  - the far terrain LOD (LOD1, below 2 ppm), which was not measured. It is coarser, but
    1 m there is under 2 px;
  - how D4 treats the profile. Its grade rule would reject about half the pieces of a
    ground-following drag on this map, so D4 needs smoothing, earthworks or structures.
    This finding does not choose among them.

## Findings (2026-09-27, D3 two-bend free drags)

Recorded on branch `codex/d3-construction-tool`
([#82](https://github.com/Kminkjan/infrastructurio/pull/82);
[#67](https://github.com/Kminkjan/infrastructurio/issues/67)). Measurements are automated
evidence, Vitest 4.1.10, Node 26.7.0 on macOS 26.6.2 (Apple M5 Pro); the e2e run is agent
evidence (Playwright 1.63.0, Chrome 153). The status of this ADR stays Proposed: the owner
decision below sets D3 planner behaviour and accepts no ADR.
- **Owner decision (2026-09-27, after the D3 feel check, as relayed to the implementing
  agent).** One drag should be able to turn beyond 90°. When no single bend reaches the
  pointer, the planner fits two bends in one drag, up to 180° (hairpins, U-turns,
  S-curves), reusing the two-bend machinery that until then served only port joins. The
  relayed context: with a fixed start heading (chaining), pointers inside the 60 m turning
  circle or behind the heading were out of reach, and 76.7–81.2% of pointers ended on their
  node with a p95 offset of about 20 m (the D3 planner finding's table).
- **Design.** The mechanism follows the decision; the details are defaults to test.
  - **Fallback, not replacement.** Where a one-bend fit (straight, curve or shift) reaches
    the pointer's node, the plan is exactly what it was. A golden hash in
    [`planner.test.ts`](../../src/core/track/planner.test.ts) holds those plans: 2,131 of
    5,760 drags (headings 0 and 1, a free start, and precision R 120; pointers every 5° all
    around at 10–200 m), recorded at `211526f` before the change and unchanged after it.
  - **Two bends at the pointer's node** otherwise: curve + curve with the end heading
    free, d0 + t1 + t2 up to ±180°, or two shifts to one side. Each curve pair is solved in
    closed form (`solveThree`); a cone test (two determinants) skips pairs whose straights
    cannot reach, and only the best 8 are kept, since only 8 are ever validated.
  - **Out of reach.** No fit of one or two bends (each at most 90°) reaches inside the
    60 m turning circles beside the start, or behind it within 120 m (twice the smallest
    radius) of its line. For those pointers:
    - Behind the start: the U-turn end nearest the pointer, at any distance. It is found
      exactly, by rounding each template pair's two square axes separately.
    - Elsewhere: the nearest node that one or two bends reach, among those reaching at
      least halfway to the pointer along the drag, by the 12-ring search; failing that, the
      nearest U-turn end.
    - Before, a pointer directly behind the start got a single straight ahead up to
      45–55 m back, and nothing farther back (an uncommitted run on the previous planner).
      The halfway rule keeps a pointer abeam inside a turning circle from getting such a
      stub.
  - **Rank of two-bend fits** (free end): valid → largest smaller radius → total turn
    nearest the arc turn τ → shortest → smallest summed |turn| → left before right →
    earlier first bend → signature. τ is the turn of the single circular arc that leaves
    the start on d0 and passes through the pointer: twice the pointer's bearing, or ±180°
    toward the pointer's side for a pointer abeam or behind. It needs no trigonometry: the
    arc's end direction is the pointer offset squared as a complex number.
  - **Precision.** A radius class applies to both bends. An end heading keeps the fits
    that end on it: one bend when one reaches the target, else two (an S-curve back onto
    d0, or a U-turn onto the opposite heading). With another end heading and nothing in
    range, the plan is empty with the precision note, as before.
  - **Unchanged:** `Drag`, `TrackPlan` (`fit: "two-bend"`, the end heading a chained drag
    leaves with, `minRadiusM`, the label), magnetism and port joins (the cone test skips
    only solves that return nothing), and the tool. Heights follow the ground as for any
    plan: the diorama probe, whose fixed-heading drags behind their start are now U-turns,
    found all 7,486 of its nodes on the ground (6,882 before).
- **Choosing the rank** (an uncommitted probe, 2026-09-27): the 446 plans that end on the
  pointer's node with two bends, for headings 0 and 1 and pointers every 5° all around at
  20–200 m on a flat map, under three orders.

  | Order | Smaller radius R 60 | Mean length | Pointers behind ending on a U-turn |
  |---|---|---|---|
  | Shortest first (the suggested order) | 100% | 241.1 m | 65.6% of 256 |
  | Radius first, no τ | 81.6% | 250.4 m | 78.9% of 256 |
  | **Radius first, then τ (chosen)** | **81.6%** | **256.5 m** | **100% of 256** |

  - Shortest first gives the minimum radius every time, since a curvature-bounded
    shortest path turns as tightly as it can: R 60 hairpins at 25 km/h with long
    straights. Radius first matches the one-bend rule and gives wide loops.
  - Without τ, 21% of pointers behind the start ended on 120° or 150° fits a little
    shorter than the U-turn. τ costs 6.1 m (2.4%) of mean length.
- **Follow, measured** (the committed forward-cone test: 425 pointers per start mode within
  ±60° at 40–200 m; `--reporter=verbose`):

  | Start heading | On the pointer's node | Median | p95 | Max |
  |---|---|---|---|---|
  | 0 (fixed) | 81.2% → 81.6% | 2.00 → 1.98 m | 20.12 → 20.12 m | 30.41 → 30.41 m |
  | 1 (fixed) | 76.7% → 78.6% | 2.00 → 2.00 m | 20.63 → 20.63 m | 30.06 → 30.06 m |
  | free | 91.1% → 93.9% | 1.77 → 1.76 m | 3.40 → 3.02 m | 4.37 → 4.37 m |

  The fixed-heading misses in this cone lie inside the turning circle, which two bends
  cannot reach either, so its p95 is unchanged.
- **All around** (a new committed measurement: 1,224 pointers per start mode, every 5° at
  40–200 m). Before, from the same grid on the previous planner (an uncommitted run):
  - heading 0: 29.7% on the node, and 533 empty plans (43.5%);
  - heading 1: 28.4%, and 568 empty (46.4%);
  - free: 90.7%.

  After, with no empty plan:

  | Start heading | On the pointer's node | Median | p95 | Max |
  |---|---|---|---|---|
  | 0 (fixed) | 47.8% | 6.49 m | 105.73 m | 121.24 m |
  | 1 (fixed) | 46.7% | 5.31 m | 104.51 m | 120.07 m |
  | free | 93.6% | 1.83 m | 3.02 m | 4.37 m |

  All 595 pointers behind each fixed heading end on a U-turn. The p95 of about 105 m is
  the U-turn's width: a pointer behind the start within 120 m of its line gets an end up to
  121 m to its side.
- **Tests (automated).**
  - Ten new drag-table cases: U-turns behind headings 0 and 1, a U-turn onto the pointer's
    node, 120° and 150° turns, both out-of-reach fallbacks beside the start, and precision
    with a radius class (a U-turn), with end heading d0 (an S-curve) and with the opposite
    end heading (a U-turn).
  - The golden hash, a rank test, determinism over build orders, and the all-around
    measurement.
  - Five oracles in
    [`planner.twoBendFree.test.ts`](../../src/core/track/planner.twoBendFree.test.ts):
    - τ against `atan2` over 2,160 bearings;
    - the tabled reach test against finding a fit, at 33,492 nodes;
    - the best-8 list against sorting every fit, over 1,014 pools;
    - the best fit against plain enumeration without `solveThree`, and the planner's plan
      equal to it, at 182 targets;
    - the nearest U-turn end against enumeration, for 48 pointers.
  - A two-bend-heavy case in [`sim/perf.test.ts`](../../src/core/sim/perf.test.ts).
  - One Playwright e2e: after an 8-node run, a pointer 40 m behind the chain's end and 50 m
    north gives a 10-piece U-turn (two R 60 bends and 8 straights) that one click builds.
  - Changed: the empty-plan test, since a drag behind a fixed heading is no longer empty
    (a precision end heading of 150° behind the start still is); the perf workload's
    8 drags behind a fixed heading, now U-turns; and the generator counts quoted in
    comments.
- **Performance, a dev measurement and not a gate.** Three alternating runs each of
  [`sim/perf.test.ts`](../../src/core/sim/perf.test.ts), before → after, on one machine
  (load varies: the before runs are slower than the D3 planner finding's single run):
  - `planTrack`, 184 fixed drags × 3 passes: median 0.089–0.106 → 0.110–0.128 ms, p95
    0.526–0.587 → 0.517–0.594 ms, max 1.13–1.66 → 1.27–1.65 ms;
  - `planTrack`, the two-bend-heavy case (348 drags × 3 passes, pointers behind the start
    and inside its turning circle over 4,900 pieces): median 0.826–0.896 → 0.146–0.163 ms,
    p95 1.209–1.326 → 0.839–0.868 ms, max 1.71–1.89 → 1.29–2.25 ms. Empty plans went from
    178 of 348 to none (252 two-bend, 96 one-bend);
  - `preview` of those plans after: median 0.016–0.017 ms, p95 0.063–0.065 ms, max
    0.33–0.47 ms;
  - the worst case the validation cap allows (the same one-bend workload): median
    2.01–2.88 → 1.84–1.87 ms, p95 2.81–4.67 → 2.34–2.96 ms.

  The costliest fallback, about 1 ms, is the 12-ring search over the turning circle's
  interior: one table of up to 4,320 curve pairs per call, plus the one-bend test at each
  ring node. A U-turn behind the start costs less than the old empty search did. No cache
  was added. The gate numbers stay D12's (preview p95 ≤ 4 ms, gate B3).
- **Not established:**
  - whether two bends in one drag feel right: that is the owner's feel check;
  - inside the turning circle nothing changed. Reaching there needs more than 180° of
    turn (a loop), beyond this decision;
  - a pointer one node behind the start already gets a U-turn about 120 m wide. The plan
    jumps from a bend ahead to a U-turn as the pointer crosses the start's square line;
  - lattice gaps: where one bend misses the pointer's node by a node, two bends now reach
    it. In the forward cone that is 12 of 425 free drags, and 2 and 8 with headings 0 and
    1. They take two R 60 or R 90 bends, mostly as a kink (30° one way, then 60° the
    other), where one bend used to end a node away (at most 4.4 m for the free drags).
    Preferring one bend a ring away would be the alternative;
  - the chosen order differs from the suggested one (shortest before radius); the halfway
    rule and τ are new heuristics;
  - timings on the gate hardware, or agreement across JavaScript engines.

## Findings (2026-09-27, D3 one bend a node off)

Recorded on branch `codex/d3-construction-tool` at `c74f36a`
([#82](https://github.com/Kminkjan/infrastructurio/pull/82);
[#67](https://github.com/Kminkjan/infrastructurio/issues/67)). Measurements are automated
evidence, Vitest 4.1.10, Node 26.7.0 on macOS 26.6.2 (Apple M5 Pro); the e2e run is agent
evidence (Playwright 1.63.0, Chrome 153). The status of this ADR stays Proposed: the owner
decision below sets D3 planner behaviour and accepts no ADR.
- **Owner decision (2026-09-27, as relayed to the implementing agent): "Prefer one bend, a
  node off".** "Only use two bends when no single bend lands within ~1 node of the pointer;
  smoother track, end sits up to ~5 m from the cursor." It takes the alternative that the
  two-bend free-drag finding named under "Not established": where one bend missed the
  pointer's node by a lattice step, two bends landed on it with a small kink.
- **Design.** The rule follows the decision; the details are defaults to test.
  - **Order:** one bend on the pointer's node N (unchanged) → one bend on a node of ring 1
    → two bends on N → the existing fallbacks (behind the start the nearest U-turn end,
    elsewhere the halfway ring search, then the nearest U-turn end).
  - **Ring 1 is N's six neighbours, 5 m from N,** so the end lies under 7.64 m from the
    pointer. The six nodes one secondary step (8.66 m) from N are left out: they would put
    the end up to 11.5 m off, well past the owner's "about 5 m", and ring 1 alone resolved
    every kink below.
  - **Choice:** nearest to the pointer first. Ring 1 is a single ring, so the plan distance
    decides; it is the float distance the snapping already uses, for choosing only, so the
    plan stays integer and no trigonometry is added. The fits of every neighbour at exactly
    that distance then go through the single-bend selection unchanged (valid → radius →
    length → …). Distance comes before validity, so validity never moves the end to a
    farther neighbour, as it never moves any target.
  - **The halfway rule** of the ring search applies to ring 1 too (it also excludes the
    start). It only bites for pointers within about 15 m of the start.
  - **Precision** follows the same rule, with the neighbours' fits restricted to its radius
    class and, when set, its end heading, exactly as at N. It fits naturally: one candidate
    function serves both.
  - **Unchanged:** every plan that one bend reaches exactly (the golden hash in
    [`planner.test.ts`](../../src/core/track/planner.test.ts), 2,131 plans, passes as
    recorded at `211526f`), `Drag` and `TrackPlan`, magnetism and port joins, the two-bend
    rank and the fallbacks, and the tool.
- **The kinks (automated).** The committed forward-cone sweep had 22 plans with two bends
  on the pointer's node (an uncommitted probe at `c699393` listed them): 12 free drags and
  6 with heading 1 were kinks (30° one way, then 60° back, at R 60 or R 90), and 4 at
  ±60°, 110 m with headings 0 and 1 were 120° turns of two 60° bends. Each is now a single
  bend on the nearest neighbour one bend reaches, 3.03–5.63 m from the pointer (median
  3.78 m; the free drags at most 4.12 m; the 120° turns become 90° bends 5.00–5.63 m
  off). The probe found these the same pieces the planner gave at `211526f`, before the
  two-bend fallback.
- **Follow, measured** (the committed forward-cone test, 425 pointers per start mode within
  ±60° at 40–200 m; `--reporter=verbose`), before → after:

  | Start heading | On the pointer's node | Median | p95 | Max | Two-bend plans (on the node) |
  |---|---|---|---|---|---|
  | 0 (fixed) | 81.6% → 81.2% | 1.98 → 2.00 m | 20.12 → 20.12 m | 30.41 → 30.41 m | 4 (2) → 2 (0) |
  | 1 (fixed) | 78.6% → 76.7% | 2.00 → 2.00 m | 20.63 → 20.63 m | 30.06 → 30.06 m | 12 (8) → 4 (0) |
  | free | 93.9% → 91.1% | 1.76 → 1.77 m | 3.02 → 3.40 m | 4.37 → 4.37 m | 12 (12) → 0 (0) |

  - The after values equal those before the two-bend fallback (the previous finding's
    "before" column): those pointers end where they did then.
  - The two-bend plans left in the cone are 120° turns toward pointers inside the turning
    circle (the ring search), unchanged.
  - The "before" two-bend counts come from the probe; the committed test counts them since
    this change.
- **All around** (the committed measurement, 1,224 pointers per start mode, every 5° at
  40–200 m), before → after; the "before" two-bend counts come from the probe:

  | Start heading | On the pointer's node | Median | p95 | Max | Two-bend plans |
  |---|---|---|---|---|---|
  | 0 (fixed) | 47.8% → 47.3% | 6.49 → 6.49 m | 105.73 → 105.73 m | 121.24 → 121.24 m | 747 → 741 |
  | 1 (fixed) | 46.7% → 45.8% | 5.31 → 5.63 m | 104.51 → 104.51 m | 120.07 → 120.07 m | 753 → 741 |
  | free | 93.6% → 90.7% | 1.83 → 1.85 m | 3.02 → 3.40 m | 4.37 → 4.37 m | 36 → 0 |

  All 595 pointers behind each fixed heading still end on a U-turn.
- **Where two bends remain** (an uncommitted probe after the change). The sweep put
  pointers every 1° within ±89° of the start heading, at 20–200 m every 2 m. It ran with
  headings 0 and 1 and a free start under the default cap, headings 0 and 1 under cap 90,
  heading 1 under cap 60, and a free start under cap 120. It found no plan that ends on the
  pointer's node with two bends turning 90° or less. On a free drag, two bends now land on
  the pointer's node only for turns beyond 90° (120°, 150°, U-turns). In precision mode
  they also land there as an S-curve back onto the start heading, for one.
- **Tests (automated):** 543 tests in 70 files (537 before).
  - **New:**
    - two drag-table cases: a free kink, now one bend a node off; and precision R 60
      with end heading 60°, one bend a node off where two R 60 bends reached the node;
    - the 22 kinks against a brute-force single-bend oracle: no single bend reaches the
      pointer's node, two bends do, and the plan ends on the nearest neighbour one bend
      reaches;
    - a 120° turn and a precision S-curve whose ring 1 no single bend reaches: still two
      bends on the node;
    - an obstacle that turns every fit at the nearest neighbour into a kinked join: the
      end stays there, although a single bend to another neighbour would be valid;
    - determinism over 10 build orders.
  - **Measurements:** the forward-cone test reports two-bend counts and asserts that none
    lands on the pointer's node; the all-around test reports them.
  - **Adjusted:** no assertion assumed exact landing, so none changed. Comments changed:
    - the two-bend oracle's: it lays two-bend plans only where no single bend reaches the
      node or its neighbours, still 182 of them;
    - two generator counts: existing-track reuse went from 17 to 16 of 150 runs, and the
      diorama probe from 7,486 to 7,511 nodes and from 187 to 186 curved plans.
  - **E2e:** the 8 Playwright e2e pass unchanged (agent evidence).
- **Performance, a dev measurement and not a gate.** Three alternating runs each of
  [`sim/perf.test.ts`](../../src/core/sim/perf.test.ts), before → after, on one machine:
  - `planTrack`, 184 fixed drags × 3 passes: median 0.106–0.107 → 0.089–0.101 ms, p95
    0.466–0.525 → 0.504–0.575 ms, max 1.02–1.08 → 0.93–1.66 ms;
  - `planTrack`, the two-bend-heavy case (348 drags × 3 passes): median 0.154–0.162 →
    0.163–0.167 ms, p95 0.860–0.906 → 0.830–0.863 ms, max 1.93–2.27 → 1.38–1.90 ms; its
    fits are unchanged (252 two-bend, 96 one-bend);
  - `preview` of the planned pieces: medians 0.016–0.032 ms before and after, p95 at most
    0.111 → 0.125 ms;
  - the worst case the validation cap allows: median 1.86–2.04 → 1.83–2.03 ms, p95
    2.63–3.39 → 2.80–3.20 ms.

  This is within run-to-run noise. The ring-1 step costs at most six single-bend solves,
  and where it succeeds it spares the two-bend solve. The gate numbers stay D12's (gate
  B3).
- **Not established:**
  - whether the track feels smoother: that is the owner's to judge, and no feel check has
    run on this build;
  - the end sits up to 5.63 m from the pointer in the cone, a little past the owner's
    "about 5 m"; ring 1's geometric bound is 7.64 m;
  - at the edge of one bend's reach, a pointer that two 60° bends reached on its node now
    gets a 90° bend a node off. A chained drag then leaves 30° short of the two-bend
    plan's heading;
  - distance before validity: when every fit at the nearest neighbour is invalid, the plan
    shows it, although another neighbour, or two bends on the node, may be valid;
  - timings on the gate hardware, or agreement across JavaScript engines.

## Findings (2026-09-27, earthworks-lite)

Recorded on branch `codex/d3-earthworks-lite`, from the D3 branch at `c699393`, code at
`c363352` ([#67](https://github.com/Kminkjan/infrastructurio/issues/67); the D4 criterion is
[#68](https://github.com/Kminkjan/infrastructurio/issues/68)'s). Measurements are automated
evidence (Vitest 4.1.10, Node 26.7.0, macOS 26.6.2, Apple M5 Pro) unless labelled agent
(Playwright 1.63.0, headless Chrome 153, same machine). The status of this ADR stays
Proposed: the owner decision pulls a render criterion forward and accepts no ADR.
- **Owner decision (2026-09-27, as relayed to the implementing agent).** "Earthworks-lite
  now": pull D4's "earthworks conform" forward in the renderer. The terrain is cut and
  filled under the track so that it always shows, in a cutting or on an embankment. Sim
  terrain is unchanged. The relayed problem: curves vanish part-way into rising ground,
  because a curve is one piece with one grade, so only its ends sit on the ground (the D3
  ground-following finding above: 13.8% of curve samples more than 1 m under, worst 14.6 m).
- **Population.** 3,000 zero-step plans from the D3 render-lift generator (same seed, now
  shared as [`tests/support/groundPlans.ts`](../../tests/support/groundPlans.ts)), 51,886
  pieces, each conformed on its own as the tool would build it. Every piece is sampled every
  0.25 m along its drawn centreline, at the centre and both rails. "Buried" means the drawn
  terrain lies above the drawn rail tops (track height + 0.45 m). The code is
  [`earthworkVisibility.test.ts`](../../src/render/terrain/earthworkVisibility.test.ts) at
  `PLANS = 3000`; the suite runs 300.
- **Before** (the natural LOD0 surface):

  | Piece kind | Centreline samples | Rail tops buried | Worst | Ballast-top edges (±1.6 m) buried |
  |---|---|---|---|---|
  | curve | 653,639 | 26.7% | 14.14 m | 38.7% |
  | shift | 19,737 | 5.7% | 1.21 m | 22.0% |
  | straight | 1,420,420 | 0.032% | 0.12 m | 7.4% |

- **The rule** ([`render/terrain/earthworks.ts`](../../src/render/terrain/earthworks.ts)).
  The mechanism follows the decision; the numbers are defaults to test.
  - For each ground-structure piece, with d the plan distance to its centreline and z the
    track height at the nearest centreline point (linear in arc length, as drawn), there is
    a cut envelope U = z + max(0, d − 3 m) / 1.5 and a fill envelope
    L = z − max(0, d − 3 m) / 1.5.
  - That is a 6 m flat formation (bed) at the track height, 0.15 m under the drawn ballast
    top, so the ballast reads, with 1 : 1.5 side slopes (33.7°) for cuts and fills alike:
    stylised and plausible for 1900 earthworks.
  - U is the lowest envelope over all pieces and L the highest. The drawn height is
    C = min(U, max(N, L)) over the natural surface N, so cuts win and no fill (and no other
    track's embankment) can rise over a track.
  - Under water the fill stops 10 cm below the surface, so it never z-fights the water
    plane. Where |C − N| ≤ 5 cm the ground stays natural, so ground-level track on gentle
    ground leaves the terrain alone.
  - A piece's reach, 3 m + 1.5 × the relief around it + 1 m, bounds the chunks it marks.
    Bridges and tunnels are D4's, and are not conformed.
- **Mesh: three options measured on the same 3,000 plans.**

  | Option | Rail tops buried | Least clearance | Ballast-top edges buried | Cost per plan |
  |---|---|---|---|---|
  | A: the rule at LOD0 nodes only (5 m) | 0% | 0.17 m | 6.2% | 39.5 nodes moved (about 855 m²), no extra triangles |
  | B: A, plus every node of a triangle under the ballast top clamped to the bed | 0% | 0.45 m | 0% | 85.3 nodes moved (about 1,847 m²), no extra triangles |
  | **C (chosen): each affected triangle refined 4 × 4, its plain neighbours fanned** | **0%** | **0.32 m** | **0%** | 183.2 triangles refined, about 2,750 triangles added before fans |

  - **A** keeps the rails clear here only as a measurement: nothing bounds it, since a 5 m
    triangle can take a vertex 5.8 m out, 1.9 m above the bed. It leaves 6.2% of the
    ballast edges sunk, and draws soft 5 m smudges with ragged edges (agent capture of a
    temporary `REFINE = 1` build, not committed).
  - **B** guarantees clear track but moves 2.2 times the ground. By the lattice geometry (not
    measured), its floors are about 8.7 m wide along primary headings, with staircase edges
    along curves.
  - **C** guarantees clear track by construction. Under the ballast top every drawn vertex
    lies within one 1.25 m sub-triangle edge of the track, inside the 3 m bed, so the
    drawn ground there is at most 5 cm over the bed: 10 cm under the ballast top and 40 cm
    under the rail tops. LOD1 refines to 2.5 m, where the rails still clear (the slope term
    adds at most 0.21 m).
  - **Skirt geometry alone** cannot show a cut, because the natural terrain covers it unless
    the terrain beneath is lowered anyway. It was not built.
- **C, in detail.**
  - A refined triangle takes the 1.25 m sub-lattice (the same triangular lattice, 4 times
    finer) with the rule's heights. A plain triangle beside one becomes a fan through the
    refined edge's vertices, in its own plane, with interpolated normals and colours, so it
    looks unchanged and there are no T-junctions.
  - Tests over the hill crossing at both LODs: every edge is used at most twice, and the
    outline length and plan area equal the plain chunk's. The drawn mesh equals the picking
    heightfield within 1 mm over more than 1,000 probes. With nothing near, a chunk equals
    the plain chunk byte for byte. Seams match the neighbouring chunk.
  - Cut faces at 1 : 1.5, plus the track's grade, can exceed the 35.26° view pitch and face
    away from the camera. FrontSide culls them, and on a heightfield the ground in front
    hides them anyway. A test checks that every triangle clockwise on screen is one of
    these (under 5% of a chunk's), and that every plan-projected triangle winds
    counter-clockwise at all six yaws.
- **After** (C): no rail-top sample is buried, at LOD0 or LOD1, for any piece kind; the least
  clearance is 0.32–0.37 m. The ballast-top edges are 0% buried at LOD0 and 0.001%
  (straights) and 0.005% (shifts) at LOD1, the far band under 2 ppm. The committed 300-plan
  test asserts that rails stay clear at both LODs and ballast edges at LOD0.
- **Depth at the centreline** (the same 3,000 plans, 2,093,796 samples; natural ground
  minus track height):
  - cut: over 8 m 0.120%, 4–8 m 0.628%, 2–4 m 1.209%, 1–2 m 2.658%, 0.05–1 m 10.978%;
  - within ±5 cm: 63.616%;
  - fill: 0.05–1 m 11.401%, 1–2 m 5.511%, 2–4 m 3.091%, 4–8 m 0.688%, over 8 m 0.098%.

  The deepest cut is 14.55 m and the highest fill 13.51 m. Beyond D4's ±4 m ground band lie
  0.75% of samples as cuts and 0.79% as fills. They would be D4 tunnels and bridges, and are
  conformed anyway here.
- **Shading.** Two in-house palette tokens: `earthworkFace` `#9E8A6C` (slopes) and
  `earthworkBed` `#7B705E` (the formation beside the ballast).
  - Each vertex carries an unclamped ramp, (movement − 5 cm) / 45 cm. The terrain shader
    ([`shaderChunks/earthwork.ts`](../../src/render/art/shaderChunks/earthwork.ts)) clamps
    it per fragment, after the splat. It picks bed or face by the smooth world normal (bed
    at y ≥ 0.97, face at y ≤ 0.88) and fades the splat (fields, roads, forest floor, AO
    tint) by the same weight.
  - The first build baked a clamped colour per vertex. At Close its crest edge sawtoothed
    along the 1.25 m triangles (agent capture). Clamping per fragment follows the smooth
    contour instead.
- **Scenery.** Trees and props collapse (scale 0 about the trunk) where their trunk or post
  stands within 5 m of a centreline (the 3 m bed plus 2 m, so crowns mostly stay off the
  ballast), or where the drawn ground moved more than 10 cm. Undo restores them exactly
  (tests). Fields fade in the shader.
  - Buildings are not moved. 255 of the 3,000 plans (8.5%) have earthworks that claim a
    building lot's centre or a corner, 873 claims in all. The building floats over the cut
    or sinks into the fill there; D3 validation does not know about buildings.
- **Picking.** The construction pick marches the drawn LOD0 heightfield, so the cursor lands
  on the ground the player sees.
  - Agent e2e: 2.8 m beside the deepest point of a hill curve, the pick lands within 0.5 m
    of the cutting floor, where the natural hill would put it metres away. Over the curve's
    rails the track picker still returns the curve.
  - A free node keeps the sim ground's height (`groundMmAt`). The snap ring over a free node
    inside an earthwork therefore floats at the natural height, which is where new track
    would start.
- **Ghost: see-through, not conformed live.** The two-pass ghost (0.7 depth-tested, 0.2
  see-through) is unchanged.
  - Of the zero-step plans, 25.3% of curve ribbon samples (5.2% of shift and 0.3% of
    straight samples) lie under the natural ground. Until built, those parts show only
    through the 0.2 pass: in the agent capture the buried curve reads as a faint white
    ribbon over the hill.
  - Conforming live would rebuild 1–4 chunks per re-plan, churn the ground under the
    pointer, and carve for invalid plans too.
- **Incremental rebuilds and cost (dev measurements, not gates).** A new revision diffs
  pieces by key. The reach boxes of pieces that left or arrived mark the chunks to rebuild:
  LOD0 first, then the scenery on them, then LOD1, in 8 ms slices, and each chunk is rebuilt
  from scratch.
  - Node, three runs of
    [`EarthworksView.test.ts`](../../src/render/terrain/EarthworksView.test.ts), 40 edits of
    8–12 pieces on the diorama, each built and undone:
    - rebuild median 1.88–2.06 ms, p95 4.66–5.30 ms, max 6.77–6.96 ms;
    - undo median 0.52–0.58 ms, p95 1.17–1.35 ms.
  - Node, a 505-piece network: the full rebuild takes 57.4–60.4 ms over 38 chunk rebuilds
    (19 chunks at 2 LODs, 36 with earthworks; 4,898 refined LOD0 triangles). The 8 ms slices
    spread it over 5–6 frames, but one chunk alone takes up to 9.9 ms, over the slice.
  - Agent browser, two runs of 20 warmed edit and undo cycles of the hill curve: edits
    3.5–6.8 ms (medians 3.8 and 4.7), undos 1.3–3.4 ms. The first, cold edit took 12–17 ms
    over 2 slices. `renderer.info.memory.geometries` grew by one over the cycles, with and
    without earthworks alike, and the D3 manual capture's own 20-cycle leak check stayed
    at 94.
  - The Default capture with the hill curve drew 1,108,173 triangles against 1,098,981
    without earthworks (+0.8%). The build is 282.23 kB gzip.
  - Gate B8 (provisional, ≤ 3 ms p95 rebuild after a 10-piece edit, all static layers;
    authoritative only in the
    [acceptance gates](../evidence/m4/2026-09-26-acceptance-gates.md)) is likely at risk:
    earthworks alone reach a 5 ms p95 here. D13 measures it; the likely levers are
    deferring LOD1 until the far band shows, and splitting heavy chunks.
- **Agent browser check (captures, not a Look Gate).** `CAPTURE=1 npx playwright test
  --project=capture`, 1280 × 800, yaw 0, Far 0.9 (LOD1 terrain), Region 2.5, Default 6 and
  Close 12 ppm. "Before" is the same build with `?earthworks=0`.
  - A curve over the hill, a free drag (226, 100) → (233, 117):
    - before, the straight lead-in shows at the forest edge and the curve disappears into
      the hill, with only a sliver of rail near its far end at Close and nothing at Region
      or Far;
    - after, the whole curve runs in a cutting at every zoom: a flat dark bed along the
      ballast, and a lighter earth face rising on the hill side to a crisp crest. At Far the
      cutting reads as a small earth leaf with the ballast stripe through it.
  - A 12-piece straight on a cross-slope by the river, (226, 115) → (238, 115):
    - before, the ballast sinks on the uphill side;
    - after, it sits on a shelf: a thin cut face above, a narrow fill below, the ballast
      whole.
  - Mid-drag over the hill, the ghost's buried part shows as the see-through ribbon.
  - No page errors or warnings.
- **Not established:**
  - whether the earthworks look right: that is for the Look Gates and the owner, and the
    colours and the 1 : 1.5 slope are in-house defaults;
  - D4 structures: deep cuts and high fills are conformed here, where D4 would build
    tunnels and bridges;
  - validation, grades and the planner, which are unchanged: the D4 grade rule would still
    reject about half of the pieces a ground-following drag makes;
  - track lowered below the water surface next to water, whose cut would show the water
    plane over it (zero-step plans never cut below it);
  - timings on the gate hardware.

## Findings (2026-09-27, render pass iteration)

Recorded on branch `codex/render-earthworks-terrain`, code at `b864b05` (from `329b69a`,
draft PR [#83](https://github.com/Kminkjan/infrastructurio/pull/83)). The trigger was owner
feedback on the earthworks above, as relayed to the implementing agent: "The groundwork/dirt
seems very pixely", then "Still a bit wonky". The look side is in
[art direction](../art-direction.md#render-pass-iteration-2026-09-27). Measurements are
automated (Vitest 4.1.10, Node 26.7.0, macOS 26.6.2, Apple M5 Pro) unless labelled agent
(Playwright 1.63.0, headless Chrome, same machine). The status of this ADR stays Proposed.
- **The rule, made smooth** ([`earthworks.ts`](../../src/render/terrain/earthworks.ts)). The
  mechanism of the earthworks-lite finding stands; four details changed.
  - **Crest and toe.** The side slope rises e(d) = ease(d − W) / S. `ease` is 0 on the
    formation, x² / 2b over b = 2 m, then x − b/2: 1 : 1.5 with a rounded crest or toe and no
    kink. The formation stays flat to W = 3 m.
  - **Daylight line.** The natural surface is clamped between L = z − e and U = z + e by
    mid + sign(x)·smin(|x|, half, k), with a polynomial smooth minimum over k = 0.6 m of height,
    narrowed to 2·min(|x|, half) so shallow ground keeps its sign.
    - It never leaves [L, U] and is exact on the formation.
    - Where the envelopes of two tracks conflict (L ≥ U) it takes U: cuts still win.
  - **Leave natural.** The hard 5 cm step is a soft band: moves up to 5 cm stay natural,
    moves from 10 cm are drawn in full, with a smoothstep between. So the ground within the
    band lies at most about 5.4 cm above the bed (calculated).
  - **Water.** Fills continue their slope under the water. Round 1's cap, 10 cm under the
    surface, left a shelf whose edge dropped over one 1.25 m sub-triangle.
  - The reach grew by b/2 + S·k = 1.9 m, to cover the round-offs.
- **The visibility guarantee holds** (same test and population as round 1, at PLANS = 3000;
  the committed suite runs 300). The fresh population is 3,000 plans with 52,114 pieces;
  round 1 recorded 51,886 pieces, so only fresh numbers are compared here.
  - No rail-top sample is buried, at LOD0 or LOD1, for any piece kind. The least clearance
    is 0.323–0.367 m.
  - Ballast-top edges: 0% buried at LOD0; 0.004% (shifts) and 0.001% (straights) at LOD1,
    the far band.
  - Before (natural LOD0 surface): curve rail tops buried 26.811% (worst 14.14 m).
  - The argument is unchanged. Under the ballast top every drawn vertex lies within
    1.25 + 1.6 m of the centreline, inside the flat 3 m formation, where the clamp gives the
    bed exactly.
- **Mesh** ([`earthworkMesh.ts`](../../src/render/terrain/earthworkMesh.ts)).
  - **Normals.** A moved vertex's normal is the smooth natural normal tilted by the
    least-squares gradient of the departure D = C − N over its six sub-lattice neighbours.
    - Round 1 blended in the raw drawn-surface normal over the first 30 cm of movement. That
      normal carries the 5 m lattice facets, and the relief chunk's ×5 slope gain magnified
      them into teeth along the lip (agent capture: they vanish at gain 1).
    - D is smooth and exactly 0 on natural ground, so no blend threshold is needed. Test: a
      6 m bank has upright normals on its bed and 33.7° ± 0.05° on its straight slope.
  - **Colour attribute.** It is now a vec3: the encoded potential max(N − U, L − N)
    (|N − U| where the envelopes conflict), the signed departure, and the centreline
    distance.
    - The potential is unclamped and piecewise smooth, so linear interpolation keeps its
      contours.
    - Plain corners that refined triangles reuse carry their true values. Unmoved vertices,
      fans among them, carry no earthwork colour weight (tested).
  - **Colours.** Moved vertices blend toward a dry bake, the land recipe without the shore
    soil (on water nodes, taken at the water level), as they move 5–60 cm. A fill standing in
    a lake is no longer coloured as the underwater bed. The D11a bake and the look bake stay
    bit-identical to `329b69a` (checked).
  - Watertightness, the drawn-heightfield equality (within 1 mm), undo byte-exactness, the
    seams and the winding tests all pass unchanged.
- **No cliff at the shore.**
  - Unit test: on a synthetic shore, no drawn sub-triangle is steeper than 1 : 1.5 (× 1.02)
    and none lies flat at the water plane.
  - Agent e2e: the owner's scene, laid with the real pointer (a drag (50, 203) → (34, 246)).
    - The rails stay clear, and within 20 m of the curve's shore end the steepest 0.5 m step
      over underwater natural ground is 0.664.
    - It finds no flat shelf at 10 cm under the water. The same test finds 30 shelf samples
      on `329b69a`.
  - Nothing is drawn flat at the water plane, so nothing z-fights it.
- **Rebuild cost** (dev measurements, not gates; five runs each, the same session).
  - 10-piece edits in
    [`EarthworksView.test.ts`](../../src/render/terrain/EarthworksView.test.ts):
    - `329b69a`: median 1.81–1.91 ms, p95 4.24–4.91 ms (the median of the five runs'
      p95s is 4.38 ms);
    - `b864b05`: median 2.05–2.29 ms, p95 4.63–6.45 ms (4.83 ms);
    - undo p95 1.14–1.28 ms against 1.16–1.28 ms.
  - A 505-piece network: the full rebuild takes 57.2–61.8 ms at `329b69a` and 59.9–67.2 ms
    at `b864b05`; its longest 8 ms slice is 8.83–9.61 ms and 9.76–11.63 ms. The cause is
    5,987 refined LOD0 triangles against 4,898 (+22%), from the round-off bands.
  - An earlier session's baseline was noisier: p95 4.45–6.05 ms, 4.92 ms across runs.
  - Agent browser: 20 warmed edit and undo cycles of the hill curve, three alternating runs
    each.
    - Edits: medians 5.95/6.15/5.95 ms at `329b69a` and 6.6/6.35/6.45 ms at `b864b05`,
      about +0.4 ms.
    - Undos: 1.7–3.4 ms and 1.7–3.7 ms.
    - `renderer.info.memory.geometries` 94 → 95 on both builds.
  - Gate B8 (provisional, ≤ 3 ms p95; authoritative only in the
    [acceptance gates](../evidence/m4/2026-09-26-acceptance-gates.md)) stays at risk, a
    little more than before. The levers are unchanged: defer LOD1 until the far band shows,
    split heavy chunks. A narrower reach margin is a third.
- **Not established:** the owner's reading of the new shapes; the look gates; timings on the
  gate hardware. Nor how the track's rounded end-cap earthworks read: at a shore node they
  form a small rounded nose into the water, as in round 1.

## Findings (2026-09-28, PR #83 review fixes)

Recorded on branch `codex/render-earthworks-terrain`, code at `8635640` (from `81663f8`,
draft PR [#83](https://github.com/Kminkjan/infrastructurio/pull/83)). The trigger was a code
review of the PR in recall mode (13 findings, not adversarially verified); each was checked
against the code before it was fixed. Measurements are automated (Vitest 4.1.10, Node 26.7.0,
macOS 26.6.2, Apple M5 Pro) unless labelled agent (Playwright, headless Chrome, same machine).
The status of this ADR stays Proposed.
- **The reach converges, per LOD** ([`earthworks.ts`](../../src/render/terrain/earthworks.ts)).
  - The loop stopped after 8 passes without rescanning its last growth. It now grows until
    the relief in the box needs no more, still capped at 120 m.
  - A LOD1 triangle interpolates corners up to one 10 m cell past the box that the LOD0 node
    scan sees, so LOD1 gets its own reach, from a scan 10 m wider.
  - Tests: a 32° slope across a run left a 0.67 m ledge at the reach, and a rise just beyond
    the scan left a 0.63 m ledge at LOD1. Both are now continuous: no jump over 5 cm between
    samples 1 cm apart.
  - On a probe of 3,815 diorama pieces (265 plans), 14 pieces had not converged in 8 passes,
    and 6 of their LOD0 reaches change. 2,328 LOD1 reaches grow, by up to 42 m. On the
    411-piece network of the new byte pin, LOD0 stays byte-identical and LOD1 changes only in
    the colour attribute.
- **Seams.** An unmoved plain corner of a refined triangle carried its colour attribute only
  in the chunk owning that triangle. The neighbouring chunk's vertex there kept zeros, so the
  lip weight (facets, slope soil) could jump along the seam: by up to 0.77 of its range on
  three diorama plans. Both chunks now write it, tested at both LODs. Positions, normals,
  colours and indices are unchanged.
- **Ghost.** Its drop lines and end-height tags measure against the drawn surface, as picking
  does; sim-facing heights keep `groundMmAt`. Agent e2e: a plan started with the real pointer
  on the hill cutting's floor shows a tag of 9.3 m, for a node 9.26 m above the drawn floor.
  Before, no tag showed.
- **Single sources.** The arc maths go through `geometry/sample.ts` (new pure centreline
  helpers), and one lattice interpolation serves the drawn heightfield and the ray march. A
  byte pin (`earthworksGolden.test.ts`, 411 pieces on the diorama), recorded at `81663f8`,
  held through those refactors and the efficiency fixes.
- **Rebuild cost** (dev measurements, not gates; the machine's load average was 7–15 while
  measuring, so the ranges overlap).
  - 10-piece edits in
    [`EarthworksView.test.ts`](../../src/render/terrain/EarthworksView.test.ts), cold (40
    edits per run): p95 4.70–5.52 ms over ten runs at `81663f8`, 4.34–5.71 ms over five now;
    median 2.09–2.37 ms against 2.11–2.30 ms.
  - Warmed (320 edits per run, five alternating runs each): p95 3.40–3.80 ms against
    3.20–3.50 ms; median 1.58–1.66 ms against 1.44–1.58 ms.
  - Undo: median 0.46 → 0.16 ms, p95 1.20–1.37 → 0.29–0.32 ms. A chunk rebuild no longer walks
    all 8,192 triangle ids of the heightfield.
  - The 505-piece network: a full rebuild of 58.6 ms against 64.3–65.9 ms.
  - The savings (pooled heights, per-chunk deletes, fewer nearest-point queries) are partly
    spent on the per-LOD reach and the seam corners. Gate B8 (provisional, authoritative only
    in the [acceptance gates](../evidence/m4/2026-09-26-acceptance-gates.md)) stays at risk.
- **Not established:** the owner's reading; the look gates; timings on the gate hardware.

## Findings (2026-09-28, earthworks re-review fixes)

Recorded on branch `codex/render-earthworks-terrain`, code at `26ae87f` (from `8f79894`, draft PR
[#83](https://github.com/Kminkjan/infrastructurio/pull/83)). The trigger was a targeted re-review of the
PR: four confirmed findings and one plausible one, relayed to the implementing agent. Each confirmed
finding has a regression test that fails against `8f79894`'s modules on the defect itself and passes now.
Measurements are automated (Vitest 4.1.10, Node 26.7.0, macOS 26.6.2, Apple M5 Pro) unless labelled agent
(Playwright, headless Chrome, same machine). The conform rule, "cuts win" included, is unchanged. The status
of this ADR stays Proposed.
- **A second, higher ground track** ([`earthworks.ts`](../../src/render/terrain/earthworks.ts)
  `settleReaches`).
  - A reach was sized from the natural relief alone. Where a higher neighbour's fill overrode this track's
    cut, the cut stopped at that reach while the fill went on, so the drawn ground jumped up to the fill.
  - A reach now also clears its neighbours at the cutoff. At plan distance R the piece's cut is at least
    its lowest bed plus the side slope's rise there. Every neighbour's fill reaching that line must stay
    0.6 m (the smooth clamp's band) under it, and every neighbour's cut that far over the piece's fill.
    Neighbour envelopes are bounded from bed samples every 0.5 m.
  - A piece keeps its natural reach wherever every neighbour clears it. Otherwise it takes the least
    0.25 m multiple above that reach which clears them. The grid makes the candidates a finite set, so
    settling ends and gives the least fixed point whatever the order.
  - `EarthworksView` re-derives only the pieces beside an edit. After a removal, every piece a neighbour
    had raised starts again from its natural reach. A test compares it with a fresh view after each of 16
    builds, undos and redos: the same reaches and bytes.
  - Tests: on flat ground, a second run 8.66–17.32 m away and 5–10 m higher drew faces with slopes of
    2.16–6.50 at LOD0 and 1.39–3.55 at LOD1. Now none is steeper than 0.77 (1 : 1.5 plus 15 %).
  - The review proposed folding each neighbour's whole bed range into the relief. Tried first, that
    raised 155 of the byte pin's 411 LOD0 reaches (by up to 41 m), took 116 ms to settle 2,188 pieces,
    and changed the pin. The cutoff check replaced it.
  - On diorama networks the settled reaches change no drawn height on the 411-piece byte pin or on a
    505-piece network. On a 2,188-piece ground-following network (300 plans), 16 of 23,801 refined LOD0
    triangles change; the steepest face among them was 2.89 before and is 0.77 after. LOD1 is unchanged
    there.
- **The chained ghost** ([`GhostView.ts`](../../src/render/track/GhostView.ts), `main.ts`).
  - A commit sets the chained ghost before the time-sliced earthworks land, and an unchanged plan was
    never measured again. `refreshGround` measures the drop lines and tags again once the conformed LOD0
    surface of a revision is drawn (`EarthworksView.surfaceRev`).
  - Agent e2e, frames held so the commit and the continuation's ghost land before the sync: the start
    tag reads "+6 m", then "0 m" once the embankment is drawn, and drop-line vertices go 8 → 6. With
    `8f79894`'s wiring the tag stayed "+6 m" (8 → 8).
- **The ghost over water** ([`heightfieldRay.ts`](../../src/render/terrain/heightfieldRay.ts)).
  - The ghost's ground now reads the water level only over the triangles the water mesh draws
    (`waterMeshCovers`, shared with `buildWaterData`). A dry cutting's floor 1.5 m under the water level,
    30 rings from water, reads 8.5 m, where it read 10 m. A cutting within the mesh's three rings of a lake
    still shows the water drawn over it.
  - Clamping only where the natural ground lies under water was rejected: it would measure from a flooded
    cutting's floor under drawn water.
- **The 120 m cap.**
  - A capped piece steepens its side slope over the last 10 m (`CAP_FADE_M`) by the rise that clears the
    ground and its neighbours at the cap. Test: a 20-piece run 90 m over flat ground. The steepest 5 cm
    step had a slope of 12.27 (a wall a sub-triangle wide); now it stays under 4.
  - The chunk pass and its mesh now run as slices: one piece, 8,192 touched sub-vertices, or 8 (pass) or
    4 (mesh) LOD rows. The view resumes a chunk across frames and swaps it in only once whole.
  - The capped run takes 8 steps over 7 slices of 8 ms, the longest 9.42 ms (one run; the overshoot is one
    slice of work). Before, one of its chunks took 15.7 ms of pass and 12.5 ms of mesh in a single slice.
- **Reach inflation on diagonal pieces: skipped.**
  - Tried: skipping nodes farther than the reach plus a cell from the centreline. It changes 108 of the
    411 pin reaches (p90 ratio 1.07, max 1.57), keeps every drawn height on three networks (3,104 pieces),
    and cuts evaluated sub-vertices by 7 % at LOD0 and 13 % at LOD1.
  - It was not kept. It changes the byte pin (the earthwork attribute at both LODs, and the reach and
    nearest hashes) without fixing a defect. On ground steeper than the side slope, heights beyond the
    tighter reach are not guaranteed to stay.
- **Coverage.** Nearest centreline points on all 12 headings, with arc centres and sweep edges; the seam
  attribute over 40 plans (was 3); incremental views against fresh ones.
- **Byte pin** (`earthworksGolden.test.ts`): every hash as at `8f79894`.
- **Captures (agent):** look `b`'s eleven render-iteration stills (reduced motion, 1280×800) are
  byte-identical PNGs at `8f79894` and `26ae87f`.
- **Rebuild cost** (dev measurements, not gates; eight alternating runs each, load average 6–7).
  - 10-piece edits (40 per run): p95 6.60–10.43 ms (median over runs 6.76) → 6.77–7.45 ms (7.02);
    median 1.99–2.43 → 2.19–2.54 ms. Undo is unchanged (median 0.15–0.18 ms).
  - The 505-piece network: a full rebuild of 60–74 ms either way; its longest 8 ms slice 9.99–12.25 →
    8.16–8.48 ms. Gate B8 (provisional, authoritative only in the
    [acceptance gates](../evidence/m4/2026-09-26-acceptance-gates.md)) stays at risk.
- **Not established:** the owner's reading of the changed cases; the look gates; timings on the gate
  hardware; the `?terrain=d11a` captures, which were not re-shot.

## Findings (2026-09-28, D4 grades and structures)

Recorded on branch `codex/d4-structures-core`, from `main` at `81779af`, code at `843e85f`
([#68](https://github.com/Kminkjan/infrastructurio/issues/68), the core half). Measurements are
automated (Vitest 4.1.10, Node 26.7.0, macOS 26.6.2, Apple M5 Pro) unless labelled agent
(Playwright 1.63.0, headless Chrome). The status of this ADR stays Proposed: the owner decision
below sets D4's height behaviour and accepts no ADR.
- **Owner decision (2026-09-28, as relayed to the implementing agent): "Auto-grade".** "Track
  follows the ground wherever it can within 35‰; the rest is absorbed by cuttings/embankments
  (±4 m) and, beyond that, automatic bridges and tunnels. The end may sit above or below the
  ground; the tooltip shows by how much." The relayed context: following the ground exactly
  (the D3 behaviour) puts about half of all pieces on the diorama above 35‰.
- **Rule 3, grade** ([`track/validate.ts`](../../src/core/track/validate.ts)). An added piece
  fails `grade-too-steep` when |num| > 35 · den on its exact rational grade. The message quotes
  the climb that is too steep and the length it needs: the run of the command's chained pieces
  around the first steep one that rise (or fall) with it, when the run as a whole exceeds 35‰
  (an end too high for its drag), else the piece alone. Example (a fixture): "The track climbs
  3 m over 50 m (6.00 %), steeper than the 3.5 % maximum; it needs 85.8 m to climb 3 m, so
  lengthen the drag or change the end height."
- **Rule 4, terrain and structure** ([`track/structure.ts`](../../src/core/track/structure.ts)).
  The rules follow #68; the sampling, water and portal details are defaults to test.
  - **Samples.** The track height is linear in arc length between the node heights (as
    clearance has it), and the terrain linear over each lattice triangle (the surface the
    renderer draws). A primary straight runs along a triangle edge, so its two nodes decide
    exactly; a secondary straight crosses one edge at its midpoint, so its nodes and that
    midpoint decide exactly, in integer mm. Curves and shifts are sampled every 0.5 m of arc
    (`sampleCentrelineEvery`), with the exact node heights at their ends; on slopes up to the
    diorama's steepest (0.66) a surface kink between samples can hide about 0.17 m. Curve
    samples are floats decided at commit time, as for clearance.
  - **Water.** A sample is over water where the terrain lies below the water level, and h is
    the bed there. Track at or above the bed is in or over the water; below it, under the water.
  - **Inference** (`auto`), with A the largest z − h and B the largest h − z: in or over water:
    bridge; else under water: tunnel; A > 4 m and B > 4 m: bridge when A ≥ B, else tunnel;
    A > 4 m: bridge; B > 4 m: tunnel; else ground. The first cut made any piece over water a
    bridge; a probe found track 8 m under a riverbed rejected as a bridge below the ground, so
    track under the bed is a tunnel.
  - **Each structure's rules**, codes in catalogue order: ground `needs-bridge` (A > 4 m, or in
    or over water), `needs-tunnel` (B > 4 m, or under water); bridge `bridge-below-ground` (the
    deck below the terrain at any sample, B > 0), `bridge-too-low-over-water` (a sample over
    water under the water level + 4.0 m); tunnel `tunnel-too-shallow` (nowhere deeper than the
    4 m band, or less than 6 m of cover farther than 10 m along the track from a portal).
  - **Portals.** A node of a tunnel piece is a portal when the track is within the ground band
    there (cover ≤ 4 m): where a tunnel meets ground track, a bridge or open air. The distance
    walks through neighbouring tunnel pieces, existing ones included, so the second 5 m piece
    is still within 10 m of the portal before the first, however the pieces were batched.
  - Only added pieces are judged; a reused piece keeps its structure. `auto` infers per added
    piece and the preview's `diff.added` carries the result; a forced structure applies to
    every added piece; an undo or redo applies the recorded structures.
- **Rule 6.** A clash (closer than 4.0 m in plan while less than 6.5 m apart in height, as in
  D2) is `vertical-clearance` where the two centrelines cross or touch in plan (the closest
  chords lie within the pieces' arc pads), else `tracks-too-close`. The message quotes the
  smallest height gap the check measured and the height missing to 6.5 m, rounded up.
  Crossings and stacked track at 6.5 m or more pass (fixtures), and a bridge over a line
  derives two plain nodes at the crossing, never a shared node or junction (fixture). The D2
  test stays conservative on slopes: heights compare as the gap between chord height ranges.
- **Codes.** 18 implemented (D2's 11, then these 7), each with a negative fixture in
  [`sim/fixtures.test.ts`](../../src/core/sim/fixtures.test.ts), on a hand-made map (flat land,
  a 5 m hill, a lake).
- **`Drag`, additive** ([`track/planner.ts`](../../src/core/track/planner.ts)): `heightMode?:
  "auto" | "fixed"` (omitted: "fixed") and `structure?: StructureChoice` (omitted: "auto"; the
  structure the build will carry, used to validate candidates). Every existing field keeps its
  meaning; in "auto" `dzMm` still names the end height the tool would want and serves only to
  find a buffer end under the pointer. The track tool passes "auto" while `heightSteps` is 0,
  plans once without the end re-plan, and its tooltip's "End height" is the plan's end above
  the ground, as before.
- **Heights, as built** (defaults to test):
  - **End.** "fixed": `from.zMm + dzMm`; a snapped port: its z. "auto": the ground at the end
    node clamped to what 35‰ reaches from the last fixed node, raised to clear water where that
    stays reachable; or, with magnetism on (not in precision), an existing node's height there
    within that reach and 6.5 m, which is the planner's vertical magnetism now.
  - **Pins** as in D3, against the profile computed so far; after each pin the profile is
    computed again. Where a pin or port leaves a span 35‰ cannot join, the span is a uniform
    ramp that preview rejects as `grade-too-steep`.
  - **Target:** the ground in "auto"; in "fixed", the D3 profile (the ground plus the offset
    apportioned between fixed nodes).
  - **Fit, per span between fixed nodes:** the largest chain of nodes that can lie exactly on
    the target (consecutive members 35‰ joins, water floors between them reachable; a node
    whose target is below its floor never lies on it), by dynamic programming in O(m²), ties to
    the nearer predecessor; then in each gap the least Σ|z − t| subject to 35‰ per piece and
    the floors, exactly in integer mm by a slope-trick pass over convex piecewise-linear costs.
    Where the target is within 35‰ the result is the target: every D3 drag case, pinning case
    and flat-map property passes unchanged.
  - **Water:** every node of a piece that crosses water gets the floor water level + 4.0 m, as
    far as 35‰ reaches from the span's fixed ends.
- **Choosing the fit** (an uncommitted probe: 1,000 free drags and 150 chains of 3–6, the
  generator in [`tests/support/autoGrade.ts`](../../tests/support/autoGrade.ts), before the
  final choice):

  | Fit | Accepted | Nodes on the ground | Mean \|z − g\| | Kept |
  |---|---|---|---|---|
  | L1 only, end on the reachable ground | 72.9% | 25.0% | 2.21 m | no |
  | L1, free end weighted 1 in the objective | 74.6% | 26.4% | 2.15 m | no |
  | L1 plus 3× cost beyond the ±4 m band | 72.8% | 25.0% | 2.21 m | no |
  | **On-target chain, then L1 (chosen)** | **72.8%** | **27.2%** | **2.22 m** | **yes** |

  - L1 alone balances cut against fill: across a 12 m valley it started descending on the flat
    approach (cutting it) to lower the viaduct. The chain keeps flat approaches on the ground
    and deviates only where the ground is too steep; on the 80‰ test ridge it leaves the flat
    on the ground and cuts 2.25 m at the crest, where L1 filled 0.68 m on the flanks' feet to
    cut 1.58 m. Aggregates barely differ.
  - A free end in the objective accepted 1.7 points more, but the relayed instruction was the
    end nearest the ground the grade allows, so that stays. Band weights 0, 1, 3 and 10 moved
    acceptance by at most 0.2 points and were dropped.
  - Also tried and not kept: re-fitting a candidate that failed `tunnel-too-shallow` with its
    shallow tunnel nodes pushed to 6 m of cover, or `bridge-below-ground` with the piece's ends
    raised over its highest terrain (acceptance 72.9% → 72.9%; up to 24 more validations per
    failing drag); and aiming a curve's ends at the least-squares line of the terrain under it
    (72.7%).
- **Diorama measurement** (the same generator, final code; the committed test runs 600 + 80):
  1,682 drags (1,000 free, 150 chains), 1,225 accepted (72.8%).
  - Rejected: `tunnel-too-shallow` 199, `bridge-too-low-over-water` 146, `bridge-below-ground`
    74, `out-of-bounds` 23, `kinked-join` 9, `tracks-too-close` 4, `grade-too-steep` 1,
    `vertical-clearance` 1.
  - Free drags and each chain's first: 80.0% of 1,150; chained continuations: 57.3% of 532.
    Excluding the 117 drags that start on water: 77.4% of 1,565.
  - Causes: 64 of the water rejections start on water and 82 on land too near the water to
    climb 4 m at 35‰ (3.4 m from a 10.6 m shore needs 97 m). Of `bridge-below-ground`, 65 are
    curves or shifts whose single grade crosses both a hollow and a rise; 27 of the 74 dip
    0.5 m or less. Of `tunnel-too-shallow`, 183 are 4–6 m of cover more than 10 m from a
    portal (109 on straights, 74 on curves or shifts), 16 have no portal within 10 m. Of the
    822 drags with a curve or shift, 140 (17.0%) fail on that piece.
  - New pieces of accepted plans: ground 86.5% of pieces (85.1% of length), bridge 11.6%
    (13.3%), tunnel 1.8% (1.6%).
  - Node height minus the ground over 31,329 nodes: 27.2% exactly on it; |d| p50 0.65 m, p95
    10.40 m, max 25.47 m; 16.6% beyond ±4 m.
  - Grades over 29,931 pieces: 0‰ 8.4%, under 10‰ 1.6%, 10–20‰ 4.4%, 20–30‰ 9.3%, 30–35‰
    76.4%, over 35‰ 0.0% (one plan, a chained drag pinned to its own track, which preview
    rejects). This terrain is steep: half the ground-following pieces exceeded 35‰ in D3.
- **Open point 4: ordinary seeded hills rarely admit a tunnel.** Committed probe
  ([`planner.grade.test.ts`](../../src/core/track/planner.grade.test.ts)): 300 dry straight
  lines of 10–60 pieces with both ends on the ground, where even the highest 35‰ profile
  between the ends lies more than 4 m under the ground somewhere, so only a tunnel can take
  them. The planner's own heights build 10 (3.3%); the deepest 35‰ profile builds 5 (1.7%);
  the rest fail `tunnel-too-shallow`. By geometry (not a test): from a portal at ≤ 4 m of cover
  the cover must reach 6 m within 10 m, so the terrain must rise at least 16.5% along the track
  (20% less the 3.5% the track can descend). An uncommitted probe of 400 such lines found that
  slope (p10 12‰, median 81‰, p90 289‰) where the cover first passes 4 m, and 17.3% at least
  165‰. A tunnel exists where a face is that steep (an example is in the test: 44 pieces from
  (253, 97) on heading 9); the gap is the rule's, and this finding recommends no threshold.
- **Performance, dev measurements and not gates.** `sim/perf.test.ts` now builds its 4,900
  pieces at z = 0 as `auto` (tunnels under 6 m or more of cover) and drags from the ground in
  "auto" mode; `main`'s code was run on the same workload. The machine was loaded (load
  average 4–21, a parallel agent), so ranges overlap; three runs each:
  - calmer (before at load 4.5, after at load 12): `planTrack` median 0.087–0.095 →
    0.153–0.159 ms, p95 0.502–0.525 → 0.629–0.694 ms; two-bend-heavy p95 0.855–0.886 →
    1.006–1.029 ms; worst case (every candidate of a 110-piece plan rejected) median 1.74–2.17
    → 2.68–2.94 ms, p95 2.38–3.17 → 3.27–4.04 ms; `preview` p95 0.100–0.112 → 0.120–0.142 ms;
  - alternating before/after at load 15–21: `planTrack` median 0.123–0.188 → 0.229–0.389 ms;
    `preview` p95 0.135–0.333 → 0.209–0.417 ms.
  - Preview stays far inside gate B3 (p95 ≤ 4 ms, provisional; authoritative only in the
    [acceptance gates](../evidence/m4/2026-09-26-acceptance-gates.md)). Planning costs about
    1.6–1.9× `main`'s: the profile (chain, fits, water tests) and rule 4 run for each of up to
    8 candidates. No cache was added.
- **Tests** (automated): 685 in 84 files at `843e85f` (652 in 82 before), 679 passing.
  - New: [`structure.test.ts`](../../src/core/track/structure.test.ts) (sampling, inference,
    each rule, the portal walk) and [`planner.grade.test.ts`](../../src/core/track/planner.grade.test.ts)
    (up a too-steep hill, into a valley, over water, through a steep-faced hill, the fixed-mode
    ramp, pins in "auto", two properties, open point 4, the diorama measurement); seven negative
    fixtures, the positive crossing, stacking and 6.5 m fixtures; a tool test of the height mode
    and end height; malformed-drag cases for the new fields.
  - Changed because D4 legitimately changes them: the D2 fixture, API and property tests ran on
    seeded maps where their track at z = 0 lay 10–40 m under the ground, so they now run on
    hand-made terrain (their keys and intent unchanged; the forced tunnel on flat ground became
    a forced bridge; the property list adds `needs-bridge`); `resolveStructure` (auto → ground)
    became `structureChoice`; the planner contract test's steep map now expects the fixed ramp's
    rejection and an auto plan at 35‰; the 6 m pinned drop reports `grade-too-steep` before
    `kinked-join`; the three hill tests keep their exact D3 expectations on a gentle 20‰ ridge
    and assert the fit on the 80‰ one; `checkShape` accepts the fit where the D3 profile
    exceeds 35‰; the diorama probe runs in "auto"; the perf workloads as above; the tool's
    chaining test drags 35 m on flat ground (1 m in 20 m is 50‰); the earthworks chained-ghost
    e2e raises 3 steps over 24 pieces (6 over 20 was 60‰, and more than 4 m is now a bridge).
  - **Failing, for the render lane** (each assumes D3 heights): `trackLift.test.ts` (rails
    against the natural terrain, nodes no longer on the ground); four `EarthworksView.test.ts`
    tests (the ridge sim runs on a seeded map unlike the view's, whose heights now decide the
    structures, and its 6 m cut is now a tunnel; the 500-piece network builds 432); the
    `earthworksGolden.test.ts` byte pin (299 conformed pieces, not 411); and two
    `earthworks.e2e.ts` scenes (agent): the hill curve and the owner's lake-shore curve are now
    rejected as `bridge-below-ground` on their curve (6.6 m and 1.3 m below the terrain).
    `tests/support/groundPlans.ts` now plans in "auto", as the tool does.
- **For the render and tool lane.**
  - Structures: `NetworkPiece.structure`, and the preview's `diff.added` for a ghost; reused
    pieces keep theirs. Only `ground` pieces should be conformed; a portal is a tunnel node with
    ≤ 4 m of cover, bridges touch the ground where their deck meets it.
  - Codes: 18 in `REASON_CODES`, messages "<what>; <fix>", so "Can't build" and the fix hint
    come out of `splitReason` unchanged; the constants are exported from `sim/api`
    (`MAX_GRADE_PERMILLE`, `GROUND_BAND_MM`, `WATER_CLEARANCE_MM`, `TUNNEL_COVER_MM`,
    `PORTAL_ZONE_MM`).
  - `heightMode` wiring is in `trackTool.planFor`; Bridge and Tunnel modes may pass
    `Drag.structure` so candidates validate as the command will. Anchoring on elevated track
    sets height steps from its height, so such a drag plans in "fixed".
- **Not established:**
  - whether auto-grade feels right: that is the owner's feel check; nothing here is human
    evidence;
  - the render of structures and the conform of ground pieces under D4 heights (the render
    half);
  - a planner that routes over or under existing track; a drag crossing ground-level track at
    the same height is rejected, and one height step raises only the end;
  - that curve samples decide identically across JavaScript engines, or timings on the gate
    hardware.

## Revisit when

- The D3 feel check finds construction unsatisfying for reasons that planner tuning, chained
  drags or extra template variants cannot fix.
- Layouts the owner wants need off-lattice geometry, transition curves or radii outside the
  six classes.
- Secondary-heading double track at 5 m reads wrong in a look gate.
- Preview or commit misses its performance budget because of template count or clearance
  cost.
- M6 roads need spacings or headings the lattice cannot give.

## History

- 2026-09-26: Proposed in the rail-first reset PR that adds ADRs 0009–0014 ([#61](https://github.com/Kminkjan/infrastructurio/pull/61)); owner decision pending.
- 2026-09-26: D1 terrain findings added (offset-row node storage, 400 × 346 default map,
  integer generation); status unchanged, still Proposed.
- 2026-09-26: D1 terrain findings amended after review (shore ramp and re-recorded hash,
  lake left out rather than merged on small maps, 300-seed flat-plateau distribution);
  status unchanged, still Proposed.
- 2026-09-26: D11a terrain generator version 2 findings added (rotated octaves, soft floor,
  re-recorded golden hash); status unchanged, still Proposed.
- 2026-09-26: D2 track-model findings added (node z in integer mm as a default, exact
  template counts and variant rule, key format, kinked-join and clearance choices); status
  unchanged, still Proposed.
- 2026-09-26: D2 findings amended after review (why secondary 60° variant 0 is a pure arc,
  clearance names the closest partner, the ±10 km node-height bound, the command-shape
  contract, the performance numbers marked as an uncommitted probe) and decision 6 and the
  open-point line pointed at the mm finding; status unchanged, still Proposed.
- 2026-09-27: D3 planner findings added (exact candidate counts, start-heading, snapping,
  selection and magnetism choices, two-bend fits, follow and performance measurements);
  status unchanged, still Proposed.
- 2026-09-27: D3 height-pinning findings added (inner nodes pinned to existing node heights
  within 6.5 m, the multi-height order, the per-position height index); status unchanged,
  still Proposed.
- 2026-09-27: D3 review findings added (the two-bend solve's period divides |det| rather than
  equalling it; a brute-force oracle now checks the shortest fit); status unchanged, still
  Proposed.
- 2026-09-27: D3 ground-following findings added (the relayed owner decision that track
  follows the ground in D3, the offset interpolation between pins, before and after
  underground numbers, the 0.15 m render lift and its measurement, the curve limit); status
  unchanged, still Proposed.
- 2026-09-27: D3 two-bend free-drag findings added (the relayed owner decision that one
  drag may turn up to 180° with two bends, the fallback and its snapping, the rank and why,
  follow and performance numbers before and after, open doubts); status unchanged, still
  Proposed.
- 2026-09-27: D3 one-bend-a-node-off findings added (the relayed owner decision to prefer
  one bend on a neighbour of the pointer's node over two bends on it, ring 1 and its order,
  the kinks, follow and performance numbers before and after, open doubts); status
  unchanged, still Proposed.
- 2026-09-27: earthworks-lite findings added (the relayed owner decision to pull D4's
  earthworks conform forward in the renderer, the conform rule, three mesh options measured,
  visibility before and after, cut and fill depths, scenery, picking, the ghost decision,
  rebuild costs); status unchanged, still Proposed.
- 2026-09-27: render pass iteration findings added (the smooth conform rule: an eased crest
  and toe, a smooth daylight clamp, a soft leave-natural band and fills continued under
  water; departure-gradient normals, the vec3 colour attribute and the dry bake; visibility
  re-measured on 3,000 plans; the shore e2e; rebuild costs before and after); status
  unchanged, still Proposed.
- 2026-09-28: PR #83 review findings added (the reach grows until it converges, with its own
  LOD1 reach; seam corners carry the colour attribute in both chunks; the ghost measures
  against the drawn surface; single sources and a byte pin; rebuild costs before and after);
  status unchanged, still Proposed.
- 2026-09-28: earthworks re-review findings added (reaches settled beside neighbours, the
  chained ghost measured again once the earthworks land, the ghost over water only where the
  water is drawn, the capped reach faded and chunks spread over slices, the diagonal reach
  change skipped, coverage and rebuild costs before and after); status unchanged, still
  Proposed.
- 2026-09-28: D4 grades and structures findings added (the relayed owner decision
  "Auto-grade" verbatim, the grade, terrain-structure and vertical-clearance rules as built,
  `Drag.heightMode` and `Drag.structure`, the height fit and the alternatives measured, the
  diorama measurement, open point 4, performance, changed and failing tests); status unchanged,
  still Proposed.
