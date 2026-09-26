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
6. **Elevation and grade.** z is integer decimetres per node, and node identity is
   (q, r, z), so a track above another at the same (q, r) is a different node. Structure
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
([simulation model open point 2](../simulation-model.md#19-open-points-2026-09-26)).

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
