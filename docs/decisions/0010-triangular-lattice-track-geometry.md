# 0010 — Triangular-lattice track geometry

- Status: Proposed
- Date: 2026-09-26
- Scope: Prototype. Track geometry and identity in the simulation core
  (`src/core/lattice.ts`, `src/core/geometry/`, `src/core/track/`, derived junctions in
  `src/core/network/derive.ts`), plus the construction ghost and precision mode in the
  tools and renderer
- Tracking: M4 epic "M4 — Epic: Living Diorama" (TBD); D1 (TBD), D2 (TBD), D3 (TBD),
  D4 (TBD), D5 (TBD)
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
