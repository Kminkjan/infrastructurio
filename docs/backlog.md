# M4 backlog — Living Diorama

- **Status (2026-09-26):** planned. No work item has started beyond the skeleton on main.
  The GitHub milestones (8–10), epics (#62–#64) and D1–D13 issues (#65–#77) were created on
  2026-09-26 and are linked under [Epics](#epics) and [Tracking keys](#tracking-keys).
- **Authority:** each item's **GitHub issue body is authoritative** for that item. This file
  stays the planning source and links each issue. Dispositions live on GitHub, and the owner
  decides them. Nothing here claims that an item is done or an issue closed.
- **Contract:** the [prototype plan](prototype-plan.md) holds the claim, exclusions, slice
  ladder and gate overview. The
  [acceptance gates record](evidence/m4/2026-09-26-acceptance-gates.md) holds the exact
  thresholds. Rules are specified in the [simulation model](simulation-model.md),
  [architecture](architecture.md) and [art direction](art-direction.md), and terms in the
  [glossary](glossary.md).

## Issue shape

Every issue body carries:
- **Parent epic:** "M4 — Epic: Living Diorama" ([#62](https://github.com/Kminkjan/infrastructurio/issues/62));
- **Dependencies;**
- **Acceptance criteria** as a `- [ ]` checklist;
- **Planning source:** `docs/prototype-plan.md`, `docs/backlog.md`;
- **Tracking key:** D1–D13.

Criteria marked **(owner)** are human-only. Agents prepare for them and record the owner's
words, labelled owner, but never tick, perform or simulate them. Playwright runs and manual
browser checks are agent evidence. Automation is never human evidence.

**Every item also has to meet these conditions:**
- It passes the per-PR checks in
  [prototype plan §5](prototype-plan.md#5-delivery-and-slice-ladder) and reports exact
  counts.
- Each new reason code gets a negative fixture (ownership table below).
- Colours come only from `src/render/art/palette.ts`, and sim ↔ world conversion goes only
  through `src/render/coords.ts`.
- There are no player lines, timetables, dispatch or fleet purchase anywhere.
- The simulation model, architecture and glossary are updated when behaviour changes.
- ADR findings are added as dated notes. Status changes need the owner.
- PRs reference issues as `Related #N`, never with closing keywords.

## Epics

### M4 — Epic: Living Diorama

- **GitHub issue:** [#62](https://github.com/Kminkjan/infrastructurio/issues/62).
  **Milestone:** M4 ([milestone 8](https://github.com/Kminkjan/infrastructurio/milestone/8)).
- **Claim:** a player can build a railway layout on terrain (curves, grades, bridges,
  tunnels, turnouts, stations, depots, block and chain signals), and autonomous trains run
  on it safely and deterministically, stop at platforms and explain their waits. The owner
  judges that it looks and feels right.
- **Children:** D1–D13.
- **Exclusions:** [prototype plan §3](prototype-plan.md#3-explicit-exclusions).
- **Completion:** only when D13 has recorded the predeclared gates and the owner walkthrough,
  and the owner explicitly accepts.

### M5 — Epic: Autonomous Rail Serves a Growing Region (placeholder)

- **GitHub issue:** [#63](https://github.com/Kminkjan/infrastructurio/issues/63).
  **Milestone:** M5 ([milestone 9](https://github.com/Kminkjan/infrastructurio/milestone/9)).
- **Claim:** settlements and industries create demand. Autonomous operators start, adjust
  and withdraw services with explanations. Rail access shapes growth, and growth creates the
  next capacity problem. Save/replay and a first-time-player session are the evidence for
  the first integrated playable loop.
- **Children:** none yet. They are planned after the M4 disposition.

### M6 — Epic: Roads Feed and Compete with Rail (placeholder)

- **GitHub issue:** [#64](https://github.com/Kminkjan/infrastructurio/issues/64).
  **Milestone:** M6 ([milestone 10](https://github.com/Kminkjan/infrastructurio/milestone/10)).
- **Claim:** lattice roads with lane presets and priorities, level crossings and grade
  separation, road access to stations, causal road traffic, mode choice and constrained town
  streets. Road-era research at tag `legacy-m0-m4` is source material.
- **Children:** none yet. They are planned after M5 evidence.

## Tracking keys

| Key | Title | GitHub issue | Depends on |
|---|---|---|---|
| D1 | Lattice, terrain and isometric camera | [#65](https://github.com/Kminkjan/infrastructurio/issues/65) | Skeleton (PR 1, [#60](https://github.com/Kminkjan/infrastructurio/pull/60)) |
| D2 | Track geometry and authoring model (core) | [#66](https://github.com/Kminkjan/infrastructurio/issues/66) | D1 |
| D3 | Track construction tool | [#67](https://github.com/Kminkjan/infrastructurio/issues/67) | D2 |
| D4 | Grades, bridges and tunnels | [#68](https://github.com/Kminkjan/infrastructurio/issues/68) | D2 |
| D5 | Turnouts and diamond crossings | [#69](https://github.com/Kminkjan/infrastructurio/issues/69) | D2 |
| D6 | Stations, platforms and depots | [#70](https://github.com/Kminkjan/infrastructurio/issues/70) | D5 |
| D7 | Blocks and signals | [#71](https://github.com/Kminkjan/infrastructurio/issues/71) | D5, D6 |
| D8 | Train movement and reservation | [#72](https://github.com/Kminkjan/infrastructurio/issues/72) | D7, D12 |
| D9 | Autonomous diorama services | [#73](https://github.com/Kminkjan/infrastructurio/issues/73) | D8 |
| D10 | Inspection, time controls and edits under traffic | [#74](https://github.com/Kminkjan/infrastructurio/issues/74) | D8 |
| D11 | Art direction (a: lookdev spike, b: final pass) | [#75](https://github.com/Kminkjan/infrastructurio/issues/75) (a and b) | a: D1; b: D3, D8 |
| D12 | Replay and bench harness | [#76](https://github.com/Kminkjan/infrastructurio/issues/76) | D2 |
| D13 | M4 acceptance gate | [#77](https://github.com/Kminkjan/infrastructurio/issues/77) | All (D1–D12) |

**Recommended order:** D1 → D11a → D2 → D3 → D4 → D5 → D6 → D7 → D12 → D8 → D9 → D10 →
D11b → D13. D11a runs beside D2, and D12 beside D5–D7. Only one agent at a time touches
`src/core/track`, `src/core/signals` and `src/core/trains`.

## Reason-code ownership

"One negative fixture per reason code" is split across the items that introduce each rule.
The validator applies its families in this fixed order.

| Family | Codes | Owner |
|---|---|---|
| Structural | `out-of-bounds`, `limit-reached`, `unknown-target` | D2 (station and depot limits in D6, signal limit in D7; the 64-train and 16-line caps are operator caps in D9) |
| Geometry | `radius-too-tight`, `turn-too-sharp`, `no-fit` | D2 |
| Grade | `grade-too-steep` | D4 |
| Terrain and structure | `needs-bridge`, `needs-tunnel`, `bridge-below-ground`, `bridge-too-low-over-water`, `tunnel-too-shallow` | D4 |
| Node topology | `kinked-join` | D2 |
| Node topology | `turnout-too-many-legs`, `double-slip-unsupported`, `crossing-off-lattice`, `diamond-with-junction`, `turnout-too-long` | D5 |
| Clearance | `tracks-too-close` (fan and diamond exemptions in D5) | D2 |
| Clearance | `vertical-clearance` | D4 |
| Entities | `platform-not-straight`, `platform-length`, `platform-on-structure`, `platform-over-junction`, `no-room-for-platform`, `depot-not-at-track-end`, `depot-stub-too-short`, `depot-exists` | D6 |
| Entities | `signal-not-on-plain-track`, `signal-exists` | D7 |
| Operational | `undo-empty`, `redo-empty`, `undo-blocked` | D2 (under traffic: D10) |
| Operational | `track-in-use` | D10 |

The service and inspection reasons (station, line, train and section) belong to D9 and are
surfaced by D10.

---

## D1 — Lattice, terrain and isometric camera

**Goal.** Build the ground the diorama stands on. In `src/core`: a deterministic lattice,
seeded terrain and integer utilities. In the render lane: a render-on-demand isometric view
of them that replaces the smoke scene in `src/app/main.ts`.

**Slices.**
- Core: S0 (utils; the boundary test already exists), S1 (lattice; `src/core/lattice.ts` and
  its test already exist) and terrain.
- Render: R0 (host, scheduler, iso camera, coords, perf monitor) and R1 (terrain, lighting,
  lattice shader).

**Acceptance criteria.**

*Core*
- [ ] `util/int.ts`: exact `isqrt` (`floor(Math.sqrt)` plus a correction step) and
  `divFloor`. Tested at perfect squares ±1 and at intermediates up to about 1.2e9.
- [ ] `util/prng.ts` (sfc32, for scenario generation only), `util/heap.ts` and
  `util/hash.ts` (FNV-1a over canonical JSON), each unit-tested. The same input always
  gives the same hash.
- [ ] Lattice:
  - axial ↔ world round-trips;
  - the 12 step vectors (primary 5 m, secondary 8.66 m);
  - rotation by 60° maps (q, r) → (−r, q+r) and the mirror maps (q, r) → (q+r, −r), both
    tested over every heading;
  - no trigonometry.
- [ ] `terrain.ts`: integer hash value-noise at lattice nodes (Int16 dm) with a river and
  lake water mask, on a parametrised map of about 2.0 × 1.5 km. The same
  `{seed, generatorVersion}` reproduces identical heights (hash test).

*Render*
- [ ] `RendererHost` (WebGLRenderer, `SRGBColorSpace`, `NeutralToneMapping`) and
  `FrameScheduler` with `requestFrame(reason)` / `setContinuous(reason)`. The loop stops
  when the page is hidden. A basic `PerfMonitor` counts frames.
- [ ] With no continuous reason active, the frame counter stays flat while idle (automated).
- [ ] `IsoCamera`:
  - orthographic, with halfW = cssW/(2·ppm);
  - pitch 35.264° held in a single constant;
  - yaw k·60° (k = 0..5) on Q/E with a 300 ms ease; k = 0 shows heading-0 lines
    horizontal, looking north;
  - position = target + D·(sin(yaw)cos(p), sin(p), cos(yaw)cos(p)), with D = 2000 m, near
    10 and far 4000.
- [ ] Zoom:
  - continuous 0.75–24 ppm;
  - named levels Far 0.9 · Region 2.5 · Default 6 · Close 12 · Detail 22 on + / −;
  - wheel factor 1.15, and pinch via ctrl-wheel;
  - zoom-to-cursor drift < 0.5 px (automated).
- [ ] Pan:
  - right or middle drag, and left drag on empty ground in Select;
  - WASD at 700 CSS px/s with small inertia (off under reduced motion);
  - Home recentres;
  - the target stays on Y = 0, clamped to the map ± 100 m.

  Arrow keys pan until D3 assigns them to the keyboard lattice cursor.
- [ ] Winding oracle: the projected (origin, east, north) triangle is counter-clockwise for
  all 6 yaws. `FrontSide` only, and a generator test checks winding against normals.
- [ ] Terrain mesh from lattice triangles using the simulation's heights, chunked with LOD
  bands (< 2, 2–5 and > 5 ppm). Water is opaque and depth-tinted.
- [ ] Lighting:
  - `HemisphereLight(#D6E4EC, #6B6A4E, 1.1)`;
  - `DirectionalLight(#FFE8C2, 2.4)` at 42° elevation, locked to camera yaw from the upper
    left;
  - one `PCFShadowMap` fitted to the view footprint with texel snapping (no CSM).
- [ ] Lattice overlay shader:
  - three line families, with `fwidth`-antialiased 1 px lines in `#F2F0E6` and 1.5 px node
    dots;
  - opacity 0 in view mode; in build mode, 0.15 overall and 0.55 within 48 m of the cursor;
  - fades out when lines would be < 5 px apart.
- [ ] Picking returns the lattice node at terrain height, using an analytic heightfield ray
  march.
- [ ] Resize uses `ResizeObserver` (`devicePixelContentBoxSize`), and DPR changes are caught
  with `matchMedia`.
- [ ] [ADR 0010](decisions/0010-triangular-lattice-track-geometry.md) gains a dated findings
  note on the lattice and terrain. Its status stays Proposed.
- [ ] Manual browser check (`npm run dev`) naming exactly what was exercised (agent
  evidence).

**Dependencies.** The skeleton (PR 1,
[#60](https://github.com/Kminkjan/infrastructurio/pull/60)).

**Notes.**
- Salvage ray-plane unprojection and instance-id picking by reading
  `experiments/m4/rendering/three-view.mjs` at `legacy-m0-m4`, then re-implementing them.
  Avoid that harness's mirrored axes and fixed canvas.
- Quality presets and context-loss recovery arrive in D11b.

## D2 — Track geometry and authoring model (core)

**Goal.** Build the authoritative track model in `src/core`. It needs piece templates that
close on the lattice, canonical keys, elevation, a single-reason validator, history, and
the `preview`/`execute`/`undo`/`redo` command API that every later item builds on.

**Slices.** Core S2 (`geometry/templates`, `geometry/piece`, `geometry/sample`) and S3
(`track/authored`, `track/validate`, `geometry/clearance`, `track/history`). There is no
render work.

**Acceptance criteria.**

*Geometry*
- [ ] Straight = one lattice step. Curve = a lead-in straight, a circular arc of radius R
  turning ±30/60/90°, and a lead-out, tangent to lattice lines. Radius classes and limits
  follow √(0.8·R):

  | Radius | Limit |
  |---|---|
  | 60 m (minimum) | 25 km/h |
  | 90 m | 30 km/h |
  | 120 m | 35 km/h |
  | 180 m | 45 km/h |
  | 240 m | 50 km/h |
  | 360 m | 60 km/h |
- [ ] Closing variants: 1 for 30°, 1 or 3 for 60°, 2 for 90°. That gives about 120 base
  templates × 6 rotations ≈ 720 oriented templates. A test proves that:
  - every oriented template ends exactly on a lattice node, with tangent continuity at both
    ends;
  - every node in the reachable cone is reachable.
- [ ] Shift pieces, both limited to 30 km/h:
  - primary: 37.5 m long, 4.33 m offset, R ≈ 82.3 m;
  - secondary: 43.3 m long, 5.0 m offset, R = 95.0 m.

  α = 2·atan(√3/15) ≈ 13.174° is a checked literal that a test recomputes.
- [ ] All lengths are integer mm, computed from `SQRT3` and `PI` with basic arithmetic.
  Trigonometry appears only in `geometry/{templates,sample,clearance}.ts` (boundary test).
- [ ] `geometry/sample.ts` yields render primitives (lines and arcs) and sampled points. The
  step never calls it.

*Model and commands*
- [ ] Canonical keys `S:q,r,z0:d:z1`, `C:q,r,z0:d:turn:R:variant:z1` and
  `H:q,r,z0:d:side:z1`, normalised so the smaller end comes first.
  - Node identity is (q, r, z), with z in integer dm. *Superseded by the 2026-09-26
    amendment on [#66](https://github.com/Kminkjan/infrastructurio/issues/66): z is integer
    mm, keys carry z in mm, and terrain stays Int16 dm
    ([ADR 0010 D2 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-26-d2-track-model)).*
  - Structure (ground, bridge or tunnel) is a piece property.
- [ ] `createSim(scenario)` supports `build-track{pieces, structure}`, `demolish{pieces}`,
  `undo` and `redo` through `preview` and `execute`. The result is
  `{ok: true, networkRev, diff, counts{new, reused}}` or
  `{ok: false, reason{code, message, refs}, highlight}`.
- [ ] `preview` shares the `execute` code path, never mutates and consumes no IDs. Property
  test: preview then execute equals execute alone.
- [ ] Keys already present count as reused. An all-reused build is a no-op with no history
  entry.
- [ ] Undo/redo is a stack of Diffs (added/removed) of depth 100, each validated like any
  edit. Property test: random command sequences round-trip through undo and redo to
  identical state hashes.

*Validation*
- [ ] The rule order is fixed: structural → geometry → grade → terrain/structure → node
  topology → clearance → entities → operational. Validation returns exactly one reason plus
  highlights, and every message suggests a fix.
- [ ] Negative fixtures for the codes D2 owns: `out-of-bounds`, `limit-reached` (5,000
  pieces), `unknown-target`, `radius-too-tight`, `turn-too-sharp`, `no-fit`, `kinked-join`,
  `tracks-too-close`, `undo-empty`, `redo-empty` and `undo-blocked`.
- [ ] Clearance:
  - `tracks-too-close` fires when the plan distance is < 4.0 m and |Δz| < 6.5 m; shared
    nodes are exempt;
  - the broadphase is a spatial hash with 20 m cells, updated incrementally;
  - arcs are sampled with sagitta ≤ 0.05 m and padded by the same;
  - clearance is decided only at commit time, and loads never re-validate.

*Derivation*
- [ ] Authored pieces are the only stored truth. `derive(authored)` is pure and sorts pieces
  by key before assigning IDs. It yields the same graph for any insertion order (property
  test). At this stage the ports are through (1,1) and buffer (1,0).

**Dependencies.** D1.

**Notes.**
- Salvage the preview/execute/single-reason and frozen-snapshot pattern by reading
  `legacy-m0-m4:src/experimental/construction/model.ts`, then re-implementing it.
- This item is core-lane exclusive (`src/core/track`). Add template and key findings to
  ADR 0010.
- Settle node-z resolution (dm vs mm) before S2; see
  [simulation model open point 2](simulation-model.md#19-open-points-2026-09-26). *Settled
  as a default on 2026-09-26: integer mm (the #66 amendment).*

## D3 — Track construction tool

**Goal.** Make laying track satisfying: drag to lay, with a truthful ghost, a new/reused
counter, one clear reason when it can't be built, and a precision mode. This is the first
point where the owner feels the game.

**Slices.** Core S4 (planner). Render R2 (track meshes from snapshots) and R4 (construction
tool). Tool reducers go in `src/tools`, and the tooltip in the HUD.

**Acceptance criteria.**

*Planner (core)*
- [ ] `planTrack(drag)` returns n straights + one curve or shift template + m straights. It
  solves a 2×2 integer system over about 100 candidates, and selects in this order:
  valid → largest radius under the user cap → shortest → smallest |turn| → left before right.
  *Extended by the owner decision of 2026-09-27, after the D3 feel check: where no single
  bend reaches a free drag's end, the planner fits two bends in the same drag, up to 180°
  ([ADR 0010 D3 two-bend finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-27-d3-two-bend-free-drags)).*
  *Refined by the owner decision of 2026-09-27, "prefer one bend, a node off": two bends
  only where no single bend reaches the end or one of its six neighbours
  ([ADR 0010 D3 one-bend-a-node-off finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-27-d3-one-bend-a-node-off)).*
- [ ] A two-bend fit joins into existing ports. Magnetism snaps within 3 nodes. Elevation is
  spread by length with largest-remainder rounding. *Refined by the owner decision of
  2026-09-27: track follows the ground in D3, so the planner spreads the offset above the
  ground rather than the absolute height, and D4 revisits it
  ([ADR 0010 D3 ground-following finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-27-d3-ground-following)).*
- [ ] A table of drag cases snaps to the exact expected pieces (unit tests). It covers
  one-bend, two-bend, shift and magnetism cases.
- [ ] The executed command carries the resolved `PieceSpec[]`, never drag input.
- [ ] Precision mode (Ctrl, or ⌥ on macOS):
  - no magnetism;
  - an explicit radius class (mouse wheel) and end heading (Q/E);
  - a live label such as "R 120 m · 35 km/h · 1.2%";
  - results stay on the lattice.

*Tool and input*
- [ ] `InputRouter` hands camera gestures to the camera first and the rest to the active
  tool. Tools are pure reducers `(state, event, ctx) → [state, effects]` in `src/tools`,
  with no three and no DOM, and are unit-tested.
- [ ] Track tool states: Idle → Pressed → Dragging (> 4 px) or Anchored (click-click) →
  Commit → chain (stays anchored at the new end). Esc steps back one level.
- [ ] The hover snap ring is green and filled on an endpoint, hollow on a node, and shows a
  turnout icon mid-track.
- [ ] `sim.preview` runs only when the snapped key changes (LRU of 16). Preview p95 is
  measured, and a value above 8 ms files a sim-in-Worker ADR.
- [ ] Height moves one elevation step at a time on PgUp/PgDn, `[` `]` or Shift+wheel.
- [ ] Undo/redo on Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y (case-insensitive), with a toast
  and a 400 ms flash of the affected pieces.
- [ ] Keyboard construction: the arrows move a lattice cursor, and Enter starts and commits.
  An aria-live status line announces the tooltip text.

*Presentation*
- [ ] The ghost draws in two passes (depth-tested at 0.7, see-through at 0.2):
  - new `#FFFFFF`, reused `#7FD1E8`, invalid `#E0584C` dashed;
  - elevated ghosts show drop lines every 20 m and end-height tags.
- [ ] Tooltip:
  - line 1: "Pieces: 8 new, 2 reused";
  - line 2: "Length 214 m · Grade 1.2 % · Min radius 180 m · End height +6 m";
  - line 3: "Hold Ctrl (⌥ on Mac) for precision · [ ] change height";
  - invalid: "Can't build: <reason>" plus the fix hint;
  - grade colour: green ≤ 1.5 %, amber ≤ 3 %, red above the maximum.
- [ ] Track meshes use three `BatchedMesh`es (ballast, sleepers, rails):
  - arcs are sampled at Δθ = min(2·acos(1 − 0.02/r), 5°), a chord error ≤ 2 cm;
  - the ballast trapezoid is (−2.2, −0.35) (−1.6, 0) (1.6, 0) (2.2, −0.35);
  - sleepers are 2.6 × 0.14 × 0.24 m, every 0.9 m;
  - rails are 0.11 × 0.16 m at ±0.817 m;
  - the far LOD (< 4 ppm) hides sleepers and shows a ballast stripe;
  - a chunk-merged fallback sits behind `TrackBatch` when multi-draw is missing.
- [ ] Static diffs apply by network revision and are time-sliced when a rebuild exceeds 8 ms.

*Evidence*
- [ ] Playwright e2e (agent evidence, via the projection hook): build a closed loop by
  dragging, then undo repeatedly back to an empty network.
- [ ] Manual browser check naming exactly what was exercised (agent evidence).
- [ ] **(owner)** Early owner feel check: the owner tries the tool, and their verdict is
  recorded as owner evidence.

**Dependencies.** D2, plus D1's camera and picking.

**Notes.**
- If the feel falls short, the fallbacks are chained drags, an auto-waypoint fallback, and
  extending the template table (data, cheap).
- The core is DOM-free, so the core half and the render half can merge as separate PRs.

## D4 — Grades, bridges and tunnels

**Goal.** Make elevation a design tool: grades, and inferred bridges and tunnels with
clearance rules. They are drawn as period structures, with earthworks and views that keep
stacked track readable and pickable.

**Slices.** Core: structure inference and the grade, terrain and vertical-clearance rules
(extending S3). Render: structures, earthworks and H/U views (extending R2 and R4).

**Acceptance criteria.**

*Core*
- [ ] The maximum grade is 35‰. `grade-too-steep` states the required length in its
  message.
- [ ] Structure inference in Auto mode:
  - ground when −4 ≤ z − h ≤ +4 m and there is no water;
  - bridge when more than 4 m above terrain, or over water;
  - tunnel when h − z > 4 m.

  The Bridge and Tunnel tools force the structure.
  *(2026-09-28: the owner replaced the Bridge and Tunnel tools with one Straight line tool, key 5, which lays a steady grade; structures are always inferred.)*
  *Thresholds changed by the owner decision 2026-09-28, "M2" (as relayed): the band is ±8 m,
  a bridge deck may sit up to 2 m into the bank within 15 m of an abutment, and a drag
  starting on water begins at the deck height; 6 m of cover, the 10 m portal zone and the
  4.0 m water clearance stay. Built on branch `codex/d4-structures`. The issue body still
  states ±4 m; amending it and ticking criteria are the owner's
  ([ADR 0010 M2 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-28-d4-thresholds-m2)).*
- [ ] Negative fixtures:
  - `grade-too-steep`, `needs-bridge`, `needs-tunnel`, `bridge-below-ground`;
  - `bridge-too-low-over-water` (below water + 4.0 m);
  - `tunnel-too-shallow` (cover < 6 m, except within 10 m of the portals);
  - `vertical-clearance`.
- [ ] A grade-separated crossing (|Δz| ≥ 6.5 m) passes clearance. A track crossing over
  another on a bridge never creates a shared node or junction in `derive` (fixture).
- [ ] Elevated drags never exceed 35‰ on any piece.
- [ ] A fixture shows ordinary seeded hills still admit a tunnel given the 4 m ground band
  and 6 m cover rule
  ([simulation model open point 4](simulation-model.md#19-open-points-2026-09-26)).
  *At the ±8 m band of the owner decision 2026-09-28 "M2", the committed fixture finds 300
  lines only a tunnel can take and the planner builds all of them. This does not tick the
  criterion.*

*Render*
- [ ] Structures follow rules:
  - a stone arch viaduct for 4–20 m over land;
  - a steel Warren truss over water or for spans > 30 m;
  - a plate-girder overpass over track;
  - tunnel portals with a hill plug;
  - piers placed clear of other tracks.
- [ ] Earthworks conform: terrain vertices near ground-level track are lowered or raised into
  cuttings and embankments, with ballast skirts.
  *Partly pulled forward, render only, by the owner decision of 2026-09-27
  ("earthworks-lite"): D3 track now sits in cuttings and on embankments, with affected
  terrain triangles refined so it always shows. Ballast skirts are not built, sim terrain
  and validation are unchanged, and structures and the grade rule stay here. This does not
  tick the criterion
  ([ADR 0010 earthworks-lite finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-27-earthworks-lite)).*
- [ ] Occlusion aids: H hides decks, U shows an underground x-ray and C cycles stacked hits.
  Proxy picking uses the DECK and TUNNEL layer bits.
- [ ] The Bridge and Tunnel toolbar modes reuse the D3 track tool with a forced structure.
  *(2026-09-28: the owner replaced the Bridge and Tunnel tools with one Straight line tool, key 5, which lays a steady grade; structures are always inferred.)*

**Dependencies.** D2.

**Notes.**
- The toolbar wiring presumes D3 has landed, while the core rules do not.
- Grade effects on speed (balancing speed on 35‰) are verified in D8.
- *2026-09-28, the D4 tunnel and portal iteration (branch `codex/d4-structures`, draft PR
  [#84](https://github.com/Kminkjan/infrastructurio/pull/84)): after the owner's second D4 feel
  check ("Not yet"), the owner answered four questions: "Needs 10 m somewhere" (an inferred
  tunnel run must lie at least 10 m under the ground somewhere, else it is a cutting up to
  10 m deep), "Compact backfill" (behind low portal faces), "Splayed wing walls" (30° toward
  the approach) and "Keep the limit, show it" (the Straight line's held end is shown, and the
  height keys keep their steps at the limit). All four are built, and portals now retain the
  hill in the core's effective ground. The 10 m rule changes the inference criterion above;
  the issue body, its amendment and every checkbox stay the owner's, and nothing here is a
  feel-check or Look Gate result
  ([ADR 0010 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-28-d4-tunnel-and-portal-iteration)).*

## D5 — Turnouts and diamond crossings

**Goal.** Make junctions emerge from geometry alone. Turnouts and diamonds are derived, with
fans and conflict groups that later make reservation safe.

**Slices.** Core S5, in part: node kinds, sections and conflict groups (`network/derive`,
`network/graph`). Render: turnout timbers and blades (extending R2).

**Acceptance criteria.**
- [ ] A turnout is derived at any node where one side has two pieces with the same outward
  heading. Side A has 1 port and side B at most 2. There is no turnout entity or command.
- [ ] Diamonds occur only at lattice nodes, with two axes each passing straight through.
- [ ] Node kinds are through (1,1), buffer (1,0), switch (1,2) and diamond. Sections split at
  switches, diamonds, buffers and fan/diamond-zone boundaries.
- [ ] Conflict groups come from union-find over the sections of each turnout fan and diamond
  zone. A crossover's two fans share one group.
- [ ] Negative fixtures: `turnout-too-many-legs`, `double-slip-unsupported`,
  `crossing-off-lattice`, `diamond-with-junction` and `turnout-too-long` (fan > 120 m).
- [ ] Clearance exempts turnout fans and diamond arms. Fixtures cover layouts that would
  otherwise report `tracks-too-close`.
- [ ] Loop, wye, crossover and diamond fixtures derive the expected nodes, sections and
  conflict groups, for any insertion order.
- [ ] Laying track that leaves an existing track at a node derives a turnout, and
  demolishing that track removes it again.
- [ ] Render: turnout timbers, and blades animated from `FrameView.switchLeg` (a static
  default leg until D8 supplies it).

**Dependencies.** D2.

**Notes.** This item is core-lane exclusive (`src/core/track` and `network`).

## D6 — Stations, platforms and depots

**Goal.** Create the places where trains stop and the places they come from, each with clear
placement rules and period buildings.

**Slices.** Core S5, in part: `place-platform`, `place-depot`, station grouping and depot
stubs. Render R5, in part: the station, depot and demolish tools, buildings and station
labels.

**Acceptance criteria.**

*Core*
- [ ] `place-platform{pieces}` accepts a straight run of 40–200 m that is not on a structure
  and not over a junction. The stop target is 3 m before the platform end, and sections split
  at platform ends.
- [ ] Negative fixtures: `platform-not-straight`, `platform-length`, `platform-on-structure`,
  `platform-over-junction` and `no-room-for-platform`.
- [ ] Platforms within 30 m laterally that overlap group into one station (max 32). Names
  come from a Baltic list indexed by a monotonic ID. The allocator never rolls back, even on
  undo.
- [ ] `place-depot{node, facing}` creates a stub section of ≥ 50 m behind a buffer at a track
  end (max 8). Negative fixtures: `depot-not-at-track-end`, `depot-stub-too-short` and
  `depot-exists`.
- [ ] `demolish{platforms?, depots?}` works, and undo/redo round-trips both commands.
  `limit-reached` has fixtures for stations and depots.

*UX and render*
- [ ] Station tool:
  - drag along a straight, and the length snaps to lattice steps with a label such as
    "Platform 120 m · fits N coaches";
  - the cursor side picks left or right, and a drag between two parallel tracks makes an
    island platform;
  - the station building is auto-placed.
- [ ] Depot tool: placed at a free end or node, and R rotates it. **There is no buy or
  dispatch UI.**
- [ ] Demolish tool: hover tints red and lists dependants, and a drag paints along the track.
- [ ] Buildings from the grammar: a station with canopy and clock, and an engine shed. Each
  stays ≤ 600 triangles (≤ 1,500 for a hero building).
- [ ] Station labels are CSS2D `<button>` elements.

**Dependencies.** D5.

**Notes.**
- **Station names:** the design disagrees with itself. The core names stations from a
  Baltic list by monotonic ID; the UX spec suggests the nearest town plus a compass suffix,
  editable by the player. **Recommendation:** ship the core list in M4. Renaming would need
  a command that is not in the M4 command set, so defer the nearest-place suffix and
  renaming to an explicit decision in the D6 issue.
- **Platform side:** `place-platform` has no side field; the side and island criteria need
  `side: left | right | island`
  ([simulation model open point 5](simulation-model.md#19-open-points-2026-09-26)), decided
  in the D6 issue.

## D7 — Blocks and signals

**Goal.** Deliver safety and legibility through signalling: blocks, stop and chain
semantics, the one-way rule and aspects, shown as a stable colour overlay.

**Slices.** Core S5, in part: `place-signal`, blocks, directed sections, request extents and
aspects. Render R5, in part: the signal tool, semaphores and the block overlay.

**Acceptance criteria.**

*Core*
- [ ] `place-signal{node, facing, kind: stop|chain}` and `demolish{signals?}` work, with
  undo/redo. Negative fixtures: `signal-not-on-plain-track`, `signal-exists`, and
  `limit-reached` at 512 signals.
- [ ] Sections split at signals, and blocks are the components cut at signals.
- [ ] Directed sections follow the one-way rule: passing a signal node in direction D is
  allowed only if a signal faces D or no signal faces −D (fixtures both ways). Reversal is
  allowed only at platform stops and in depots.
- [ ] Request extents are unit-tested:
  - from a stop signal, platform or depot, the extent runs to the next signal of any kind or
    to the destination;
  - from a chain signal, it runs through further chain signals to the next stop signal or to
    the destination;
  - requests are all-or-nothing;
  - a network without signals is one extent.
- [ ] Aspects are display only:
  - a stop signal shows green when the next section is free or held by the approaching train;
  - a chain signal shows partial when its first section is free but a later part is blocked.

  They are tested against fixture holdings before trains exist.
- [ ] Blocked-exit fixture, at extent level: at a junction, a stop signal's extent lets the
  tail foul the junction, while a chain signal's extent reaches the next stop signal and the
  train waits outside. The moving-train version is golden scenario 3 (D9).

*Render and UX*
- [ ] Signal tool: the cursor side picks the direction and R flips it. A flyout sets stop or
  chain, and a click places the signal and shows the block overlay.
- [ ] Semaphore arms ease over 400 ms. At far zoom, signals become screen-space dots.
- [ ] Block overlay:
  - ribbons in six colours (`#F2C94C`, `#4FC3D9`, `#D65DB1`, `#F08A4B`, `#8C7AE6`,
    `#F4F4F4`) plus a colour-blind-safe set;
  - one-way blocks always get chevrons;
  - O toggles overlays.
- [ ] Greedy colouring keeps previous colours, so an edit elsewhere leaves untouched blocks'
  colours unchanged (test).
- [ ] [ADR 0011](decisions/0011-signalling-and-reservation.md) gains a dated findings note.
  Its status stays Proposed.

**Dependencies.** D5, D6.

**Notes.** This item is core-lane exclusive (`src/core/signals`).

## D8 — Train movement and reservation

**Goal.** Put trains on the layout that move physically, reserve their way through blocks
and never collide.

**Slices.** Core S6 (pathfind), S7 (one train on a fixed route) and S8 (reservation,
multi-train). Render R6, in part: vehicles, bogies, steam, the reservation overlay, and
blade and arm animation.

**Acceptance criteria.**

*Routing and movement*
- [ ] Pathfinding is a multi-target Dijkstra over (dirSection, canReverse):
  - integer ms costs and a 30 s reversal penalty;
  - ties broken by (cost, dirSectionId);
  - K candidates are returned, one per platform.
- [ ] Consist: a tank locomotive (10 m) plus c coaches (9 m, with 1 m gaps), where
  c = min(4, ⌊(shortest platform on the route − 15 m)/10⌋), and at least 2.
- [ ] Integer kinematics at dt = 100 ms, in mm, mm/s and mm/s², using `isqrt` and `divFloor`:
  - vmax 16,666 mm/s;
  - a_t = min(400, ⌊4,000,000/max(v, 1000)⌋) mm/s² (K = 4e6 mm²/s³ ≈ 4 W/kg; the planning
    notes' 4e9 never binds, see
    [simulation model open point 1](simulation-model.md#19-open-points-2026-09-26));
  - grade 9.81·‰, weighted by overlap;
  - resistance 20;
  - planned braking 600 (capability 900).
- [ ] Controller:
  - vLimNow is the minimum limit over the footprint, held until the tail clears;
  - vAllowed adds look-ahead to limits within 300 m and isqrt(2·b·max(0, EOA − head));
  - the head stops exactly on the target mm.
- [ ] Dwell is 20 s. At a terminus the train reverses in place, bunker-first, with a 30 s
  dwell.
- [ ] Speed-profile golden (scenario 6):
  - braking from 60 km/h takes about 231 m;
  - the balancing speed on 35‰ is 10.5–11.5 m/s;
  - a restart on 35‰ succeeds.
- [ ] Braking on a 35‰ descent stays within the 900 mm/s² capability: braking is planned
  net of grade, so head ≤ EOA never relies on the clamp
  ([simulation model open point 3](simulation-model.md#19-open-points-2026-09-26)).

*Reservation*
- [ ] The resources are sections (holder = trainId or −1) and conflict groups (holder plus
  refcount).
- [ ] A train requests when its distance to EOA ≤ brakeDist(v) + 150 m. EOA is the end of
  the last held section, less 3 m before a signal.
- [ ] Arbitration is FIFO by (firstRequestTick, trainId):
  - route candidates are tried in order, which is how a train picks a free platform;
  - a candidate is grantable when every resource is free or held by this train, and not in
    this tick's `wanted` set;
  - a denial records `blockedBy` and adds soft wants.
- [ ] Sections behind the tail are released after movement.
- [ ] Tick order: commands → operator → reservation requests → movement (trainId order) →
  release and occupancy → arrival, dwell and reversal → deadlock scan → invariants → tick++.
  A shuffle property test shows that movement order does not change the hash.
- [ ] FIFO-at-a-merge fixture: service alternates and the wait stays bounded. The old fixed
  priority starved one side.

*Safety*
- [ ] Invariants are checked every tick in tests:
  - exclusive sections and groups;
  - occupied ⊆ held;
  - head ≤ EOA;
  - speed ≤ limit;
  - constant train length;
  - no train on missing pieces;
  - no orphan holdings;
  - derive == cached network.
- [ ] Soak: seeded random networks run 10k ticks with invariants checked every tick, and
  record zero violations. No train ever enters a held block or passes a red signal.

*Views and render*
- [ ] `FrameView` is produced every tick with:
  - tick and simMs;
  - trains (id, lineId, status, prevHeadMm, headMm, section window, cars, speedMms);
  - signalAspect (`Uint8Array`), sectionHolder (`Int32Array`) and sectionOccupied;
  - switchLeg and events.
- [ ] Host loop:
  - `acc += dtWall·speed`, with at most 40 steps per frame;
  - alpha = acc/100, clamped at 1;
  - the renderer interpolates lerp(prevHeadMm, headMm, alpha) along arc length and never
    extrapolates (test: the drawn head never passes headMm).
- [ ] Vehicles come through `AssetRegistry`: the 0-6-0 tank engine and the four-wheel
  clerestory coach (the M4 consist), as one `InstancedMesh` per vehicle type. Bogies are
  evaluated along the path, with pitch and cant.
- [ ] Steam puffs:
  - a pool of 2,000 instanced icosahedra with `alphaHash` dissolve;
  - emitted from the chimney anchor at 2/s + 6/s·effort;
  - rising at 2.5 m/s, with a 3–5 s lifetime.
- [ ] Overlays and animation: reservations as marching ants in each train's hue and occupied
  sections in red. Turnout blades follow switchLeg, and semaphore arms follow signalAspect.
- [ ] [ADR 0012](decisions/0012-tick-units-determinism.md) gains a dated findings note. Its
  status stays Proposed.
- [ ] Manual browser check naming exactly what was exercised (agent evidence).

**Dependencies.** D7, D12.

**Notes.**
- The tender engine, boxcar, open wagon and tank wagon are kit items. M4 runs no mixed
  stock, so they can wait for D11b or later.
- This item is core-lane exclusive (`src/core/trains`, `src/core/signals`).

## D9 — Autonomous diorama services

**Goal.** Bring the layout to life with no player orders. One operator decides lines and
train counts, and every decision and every jam explains itself.

**Slices.** Core S9 (deadlock, reasons) and S10 (operator). UI: notifications.

**Acceptance criteria.**

*Operator*
- [ ] One regional operator runs on a network change (after a 50-tick debounce) or every 600
  ticks.
- [ ] Reachability runs from each depot exit. Two stations are adjacent when routes exist in
  both directions that don't pass a third station's platform.
- [ ] Lines come from a chain decomposition of the station graph:
  - stations with degree ≠ 2 are anchors;
  - anchor-to-anchor chains are shuttles;
  - an anchor-free cycle is a loop line if trains can circulate without reversing.

  Line IDs are monotonic and matched by station sequence, with a maximum of 16.
- [ ] Each line gets the depot with the shortest travel time to its first station.
- [ ] Train count n* = ⌈round trip / headway⌉ at a 6 min placeholder headway, capped at 6
  per line and 64 in total. It is then adjusted:
  - static passing bound: a shuttle with no divergence gets 1 (`capped-no-passing`),
    otherwise passing places + 1; a loop gets max(1, waiting points − 1);
  - empirical growth: +1 per clean round trip;
  - deadlock backstop: `capped-deadlock`, reset when a construction diff touches the route.
- [ ] Spawning needs a free stub, a reservable exit and 30 s since the last spawn. To
  withdraw, a train finishes its trip, then goes to a depot. With no depot it is `stranded`
  and despawned after 60 s. Invariant: spawned = active + despawned + withdrawn.
- [ ] `inspect` for a line reports the headway, flagged as a placeholder.

*Deadlock*
- [ ] Every 10 ticks the operator builds the wait-for graph and runs Tarjan SCC.
  - A cycle that doesn't move for 300 ticks (30 s) sets `deadlock` and emits one event. The
    event names the trains, sections and signals, with the hint "add a passing loop with
    signals".
  - At 1,200 ticks (120 s) the operator withdraws the highest-ID train in the cycle and logs
    it.
  - `waiting-long` is raised after 90 s without progress.

*Reasons*
- [ ] Every reason code is reachable in at least one fixture:
  - station: `served`, `not-connected-to-depot`, `no-other-station-reachable`,
    `line-capped`;
  - line: `running`, `no-depot`, `leg-unreachable`, `capped-no-passing`, `capped-deadlock`,
    `capped-waiting`, `capped-max`;
  - train: `running`, `dwelling`, `reversing`, `waiting-signal` (with the signal, blocking
    train and section), `queued-behind`, `slowed-curve`, `slowed-grade`, `deadlock`,
    `no-route`, `withdrawing`, `stranded`;
  - section: `free`, `reserved-by`, `occupied-by`, `one-way`.

*Golden scenarios* (built via commands only, operator-driven, with checkpoint hashes
recorded)
- [ ] 1: single-track shuttle capped at 1.
- [ ] 2: passing loop with 2 trains and no deadlock over 2 simulated hours.
- [ ] 3: blocked exit, stop vs chain.
- [ ] 4: FIFO at a junction.
- [ ] 5: diamond.
- [ ] 8: loop line.
- [ ] 9: unreachable station.
- [ ] 10: two-platform station.
- [ ] 11: forced deadlock, detected ≤ 30 s, withdrawn at 120 s, then `capped-deadlock`.

Scenario 6 belongs to D8 and scenario 7 to D10.

*Player role and UI*
- [ ] No line, timetable, dispatch or purchase control exists anywhere. The toolbar holds
  exactly Track, Signal, Station, Depot, Bridge, Tunnel and Demolish, plus Undo/Redo
  (e2e assertion).
- [ ] Notifications fire for `deadlock` and `waiting-long`.
- [ ] [ADR 0014](decisions/0014-autonomous-diorama-operator.md) gains a dated findings note.
  Its status stays Proposed.

**Dependencies.** D8.

**Notes.** Deferred to M5 or later: demand, passengers, cargo, towns, money, mixed stock,
operator-run timetables (autonomous; never player-set) and competition. The placeholder
operator is replaced in M5.

## D10 — Inspection, time controls and edits under traffic

**Goal.** Let the player ask "why?" of anything, control time, and keep building while
trains run, without ever corrupting the simulation.

**Slices.** Core S11a/b (`sim/remap`) and `inspect(q)`. UI R6, in part: the inspector with
Show, EntityList, time controls and HUD.

**Acceptance criteria.**

*Inspection*
- [ ] `inspect(q)` returns status and reason, with refs for highlighting, for trains,
  signals, sections, stations and lines.
- [ ] The train inspector shows status and reason, for example "Waiting at signal S-12:
  block B-7 occupied by Train 3". **Show** pans to the blocker and draws a leader line.
- [ ] The signal inspector shows the aspect and why. The line inspector marks the headway as
  a placeholder.
- [ ] Stuck trains raise a notification.
- [ ] EntityList offers keyboard targets for trains, signals, stations and depots.

*Time and HUD*
- [ ] Time controls: Pause, 1×, 2×, 4× and 10×. Space pauses, and `,` / `.` step the speed
  down and up. The date "January 1, 1900, 08:00 AM" derives from the tick, and the core
  never sees wall time.
- [ ] HUD layout:
  - top-left: menu;
  - top-centre: "Trains 12 · Moving 9 · Waiting 3 · Avg wait 14 s", computed from
    `FrameView`, with no passenger or cargo counters;
  - top-right: time controls, date, Overlays, Help, Notifications and Settings;
  - parchment panels throughout.

  React is fed through `useSyncExternalStore` and never runs in the frame loop.

*Edits under traffic*
- [ ] S11a: any edit touching a held section is rejected with `track-in-use`, naming the
  train IDs and pieces (negative fixture).
- [ ] S11b:
  - the committed zone runs from the tail to max(head, head + brakeDist(v) + 10 m); a
    stopped train commits only its footprint;
  - an edit is accepted only if every committed zone still maps onto existing, connected
    pieces with exclusive holdings;
  - on success, reservations beyond the zone are cut back and re-requested and routes are
    re-planned;
  - with no route, the train stops safely with `no-route`.
- [ ] Undo/redo under traffic is validated like any edit (`undo-blocked`). Trains, time, the
  operator and the allocators are never in history.
- [ ] Property test: random edits during traffic keep every invariant. Golden scenario 7
  (edit while running) replays to identical hashes.
- [ ] Demolishing occupied track in the UI shows `track-in-use` and highlights the blocking
  trains, which is the walkthrough's last step.
- [ ] Playwright e2e (agent evidence): inspect a waiting train, press Show, change speed,
  and attempt to demolish occupied track.

**Dependencies.** D8.

**Notes.**
- Line-level reasons appear once D9 lands.
- S11a can merge before S11b.

## D11 — Art direction (a: lookdev spike, b: final pass)

**Goal.** Make the diorama look like a calm, original Baltic miniature from around 1900.
D11a tests the look early on a static scene. D11b finishes and hardens it once track and
trains exist.

**Slices.** D11a = R3 (scenery kit and static diorama, plus scenario scenery). D11b = R7
(hardening and bench).

**Acceptance criteria: D11a (lookdev spike).**
- [ ] `src/render/art/palette.ts` holds the full palette from
  [art direction](art-direction.md) and remains the single colour source.
- [ ] Materials: `MeshLambertMaterial` with vertex and instance colours, about 12 materials.
  Trees, roofs and rocks use flat shading; terrain is smooth.
- [ ] Lighting:
  - `SRGBColorSpace` and `NeutralToneMapping` at exposure 1.0;
  - the D1 lights, with shadow intensity 0.72, radius 3, bias −0.0004 and normalBias 0.03;
  - baked vertex AO plus a world AO tint map;
  - a CSS vignette.
- [ ] Shader chunks are isolated `onBeforeCompile` modules: grain (world-space noise, ±6 %
  luminance), windSway, foliageTint and edgeFade.
- [ ] A terrain splat map for dirt, cobble, field and forest floor.
- [ ] Instanced trees (spruce, pine, and deciduous/birch) at 2 LODs, with sway and about
  15 % oversize.
- [ ] Buildings come from a grammar of footprint × 1–3 floors × roof (gable, hip, mansard or
  tower) × wall and roof material × details.
  - Kinds: stucco townhouse, Baltic wooden house, brick warehouse, twin-tower church (the
    landmark), station with canopy and clock, engine shed, water tower, post windmill with
    rotating sails, and farmstead.
  - Each stays ≤ 600 triangles (≤ 1,500 for a hero building), merged per chunk.
- [ ] Props: telegraph poles every 50 m, lamps, fences and haystacks.
- [ ] `AssetRegistry.get(kind, variant, lod)` returns geometries per material slot, anchors
  (smoke, bogie_front/rear, coupler, door), a footprint and a budget.
- [ ] Place names use self-hosted EB Garamond (OFL, woff2 subset). UI numerals use system-ui
  or Inter.
- [ ] A dev tweak panel for palette and lighting.
- [ ] The base look holds with post-processing off.
- [ ] Four bookmark views and the pitch A/B (35.264° against 30°) are ready beside the mood
  board. There are no captures of the reference game in the repo.
- [ ] **(owner)** Look Gate A: the owner scores palette, charm, legibility, cohesion and
  originality on a 1–5 scale and records the verdict.
- [ ] Manual browser check naming exactly what was exercised (agent evidence).

**Acceptance criteria: D11b (final pass).**
- [ ] A final palette and lighting pass addresses the owner's Look Gate A notes.
- [ ] Quality presets:
  - **Low:** DPR 1, no shadows (baked AO only), no post.
  - **Medium** (the default): DPR ≤ 1.5, a 2048 PCF shadow map with radius 2, default MSAA,
    CSS vignette.
  - **High:** DPR ≤ 2, a 4096 shadow map, and a lazy-loaded `EffectComposer` chain: MSAA
    target → half-res GTAO → grade → optional tilt-shift → `OutputPass`. Tilt-shift is off
    while a construction tool is active.
- [ ] Dynamic resolution scales 0.7–1. The auto-preset drops one level if p90 > 20 ms over
  the first 3 s.
- [ ] Ambient animation runs at 30 fps and is off under reduced motion or power saver.
  Reduced motion also disables pan inertia.
- [ ] Context loss and restore rebuild the scene from snapshots (test with a forced loss).
- [ ] UI scale 90–150 %, and a selectable colour-blind-safe overlay set.
- [ ] Budgets on `bench-m4`: ≤ 150 draw calls at Default zoom and ≤ 250 at Far. Per-asset
  triangle budgets hold, and there are no leaks over 200 edit/undo cycles. These numbers
  are provisional; the [gates record](evidence/m4/2026-09-26-acceptance-gates.md) (B7, B9)
  governs.
- [ ] [ADR 0013](decisions/0013-rendering-and-art-pipeline.md) gains a dated findings note.
  Its status stays Proposed.
- [ ] The build is ready for the owner walkthrough (Look Gate B, held in D13).
- [ ] Manual browser check naming exactly what was exercised (agent evidence).

**Dependencies.** a: D1. b: D3, D8.

**Notes.**
- D11b is time-boxed.
- Mighty Tiny Railways is a mood reference only; its assets, names, UI and screenshots are
  never copied. Forms and colours come from public-domain 1900 Baltic sources.

## D12 — Replay and bench harness

**Goal.** Make determinism and performance measurable before trains exist, so that every
item from D8 onward is soaked, replayed and benched from its first PR.

**Slices.** This pulls the harness part of S12 forward: `sim/invariants`, `sim/save`,
hashing and bench. It also covers the render-side PerfMonitor overlay and the Playwright
bench. `sim/views` is completed alongside D8.

**Acceptance criteria.**
- [ ] `sim/invariants.ts` runs every tick in tests, every 100 ticks in dev, and is off in
  production. Each invariant has a negative self-check that corrupts state and expects
  detection.
- [ ] `save()` → `WorldSave` and `loadSim(save)` hold enough state that save → load →
  continue equals uninterrupted play.
  - Terrain is stored as `{seed, generatorVersion}`.
  - Loads never re-validate.
  - Nothing is written to IndexedDB.
- [ ] Checkpoint hashes are FNV-1a over the canonical JSON of the world state.
- [ ] Replay equalities are tests:
  - `step(1)×N == step(N) == step(10)×N/10`;
  - save → load → continue == uninterrupted play;
  - a `(tick, cmd)` log replays to identical checkpoint hashes, including in a fresh
    process.
- [ ] A small seeded `forAll` property helper, with no new dependency.
- [ ] `vitest bench` suites for tick, 10-tick batch, preview and commit. Their budgets are
  committed to `bench/budgets.json` before the first run and match the owner-approved gates.
- [ ] PerfMonitor overlay (F3): frame time, CPU per frame, draw calls and triangles. GPU
  time is "n/a" when not exposed.
- [ ] The Playwright bench writes JSON reports (p95 = s[floor(0.95·n)], missing samples
  null). It targets the `bench-m4` scene, whose composition is fixed in the gates record.

**Dependencies.** D2.

**Notes.**
- The `bench-m4` scene fills in as D4–D9 land. Until then, benches report what exists and
  never extrapolate.
- Salvage the invariant and replay fixture style by reading `experiments/m4/lane-fixture.mjs`
  and its `.checks.mjs` at `legacy-m0-m4`, then re-implementing it.

## D13 — M4 acceptance gate

**Goal.** Run the predeclared gates, record the owner walkthrough, and publish a recommended
disposition. The owner decides.

**Acceptance criteria.**
- [ ] The [gates record](evidence/m4/2026-09-26-acceptance-gates.md) was approved by the
  owner before any measurement (in the PR that adds it) and has not been retuned since. Any
  proposed change goes to the owner first and is recorded as such.
- [ ] Gate A (automated) is recorded:
  - every test and fixture count;
  - the safety soak (50 layouts × 10 simulated minutes: 0 double-held sections, 0 signals
    passed at danger, 0 overlaps);
  - determinism (3 fixtures × 1 simulated hour, identical hashes across fresh processes and
    across save/load at the halfway point);
  - undo round-trips for every command type;
  - the boundary test, both typechecks, the build and `git diff --check`.
- [ ] Gate B (performance) is recorded on the Apple M5 Pro reference machine, with raw JSON
  committed. The mid laptop is measured or recorded as "deferred, not passed".
- [ ] **(owner)** Gate C: the owner performs the walkthrough (Look Gate B) and scores
  palette, charm, cohesion, originality, mood, readability at 3 zoom levels and
  construction feel, with a friction log. Agents
  never perform, simulate or narrate it; they record the owner's words, labelled owner.
- [ ] Each record is a dated file under `docs/evidence/m4/` stating the SHA, environment,
  commands, counts, raw JSON and non-claims. Every observation is labelled automated, agent,
  owner or participant.
- [ ] A disposition record recommends an outcome and lists every miss as a miss. The owner
  decides, and GitHub records it.

**Dependencies.** All of D1–D12.

**Notes.** An owner session is not first-time-player validation, which belongs to M5.
Preparation is not acceptance.
