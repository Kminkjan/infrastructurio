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
