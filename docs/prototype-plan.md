# M4 prototype plan — Living Diorama

- **Status (2026-09-26):** planned. The owner approved the rail-first "living diorama"
  reset in conversation on 2026-09-26. Main holds only the skeleton: the lattice core, the
  coordinate convention, a palette module and an isometric smoke scene
  ([archive](archive/README.md), [ADR 0008](decisions/0008-archive-road-era-and-restart.md)).
  Preparation is not acceptance: nothing in this document claims that M4 or any slice is
  done.
- **Tracking:** epic "M4 — Epic: Living Diorama"
  ([#62](https://github.com/Kminkjan/infrastructurio/issues/62)) in milestone M4
  ([milestone 8](https://github.com/Kminkjan/infrastructurio/milestone/8)). Work items are
  tracking keys D1–D13 in [the backlog](backlog.md), GitHub issues
  [#65](https://github.com/Kminkjan/infrastructurio/issues/65)–[#77](https://github.com/Kminkjan/infrastructurio/issues/77).
- **What governs what:** this file is the M4 contract (claim, scope, slices, gate overview).
  The [roadmap](../ROADMAP.md) holds the one-paragraph milestone claims. The
  [acceptance gates record](evidence/m4/2026-09-26-acceptance-gates.md) holds the exact
  thresholds and wins wherever a number here differs. GitHub records dispositions, and the
  owner decides them.

## 1. Claim

> A player can build a railway layout on terrain (curves, grades, bridges, tunnels,
> turnouts, stations, depots, block and chain signals), and autonomous trains run on it
> safely and deterministically, stop at platforms and explain their waits. The owner judges
> that it looks and feels right.

**The question M4 answers:** is designing rail infrastructure, and only infrastructure,
worth doing on a calm isometric diorama when autonomous trains bring it to life?

**What M4 does not answer:** whether the full loop is fun (towns, demand and growth are M5),
or whether a first-time player understands the game (M5's participant session). An owner
session is not first-time-player validation.

**Player role** (unchanged, [vision](vision.md)): the player only designs infrastructure:
track, turnouts, signals, stations and platforms, depots, bridges and tunnels. Services are
autonomous and inspectable. The player never buys trains, draws lines, writes timetables,
dispatches or grants subsidies, and the game has no scripted endings, bottlenecks or growth.
It is forgiving and explainable ("why is this train waiting?").

## 2. What the living diorama must demonstrate

Terms are defined in the [glossary](glossary.md). Exact rules are in the
[simulation model](simulation-model.md) and [art direction](art-direction.md).

**Build.**
- Snapping to a 5 m triangular lattice with 12 headings at 30° (the existing
  [`src/core/lattice.ts`](../src/core/lattice.ts)). Pieces are straights, curves in six
  radius classes (60–360 m, 25–60 km/h) and one-row shift pieces for crossovers and passing
  loops. Every piece closes exactly on the lattice.
- Drag-to-lay with a ghost (white = new, cyan = reused, red dashed = invalid), a "N new,
  M reused" counter, and exactly one rejection reason with a fix hint. Precision mode (Ctrl,
  ⌥ on macOS) picks the radius and end heading explicitly and stays on the lattice.
- Grades up to 35‰ in integer-mm height steps (175 mm per 5 m; mm replaced dm as a default
  on 2026-09-26, see the
  [ADR 0010 D2 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-26-d2-track-model)).
  Structure is inferred as ground, bridge or tunnel, or forced by the Bridge and Tunnel
  tools. A track crossing over another on a bridge never connects to it.
  *(2026-09-28: the owner replaced the Bridge and Tunnel tools with one Straight line tool, key 5, which lays a steady grade; structures are always inferred.)*
- Turnouts and diamonds are derived from geometry, never placed as entities. Stations form
  from straight platforms (40–200 m). Depots sit on stubs of ≥ 50 m. Signals are stop (block)
  or chain.
- Undo/redo covers every command type (depth 100), including while trains run.

**Run.**
- One autonomous operator derives lines from the station graph, assigns depots and spawns
  trains at a 6 min headway that is labelled as a placeholder in the inspector. Train counts
  are capped by passing capacity ([ADR 0014](decisions/0014-autonomous-diorama-operator.md)).
- A tank locomotive with 2–4 coaches runs at up to 60 km/h on integer kinematics at 10 Hz.
  Trains stop exactly at platform targets, dwell 20 s and reverse at termini.
- Path reservation through blocks is all-or-nothing and FIFO by (firstRequestTick, trainId).
  No section ever has two holders and no train passes a signal at danger
  ([ADR 0011](decisions/0011-signalling-and-reservation.md)).
- Deadlocks are detected within 30 s, explained, and broken by withdrawing one train at
  120 s. The layout stays editable while trains run (committed-zone rule).

**Explain.**
- Every train, signal, section, line and station has an inspectable status and reason, for
  example "Waiting at signal S-12: block B-7 occupied by Train 3". **Show** pans to the
  blocker and draws a leader line.
- The block overlay keeps stable colours and marks one-way blocks with chevrons.
  Reservations show as marching ants and occupied sections in red.
- The HUD counts only real things: Trains · Moving · Waiting · Avg wait. It never shows fake
  passenger or cargo numbers.

**Determinism** ([ADR 0012](decisions/0012-tick-units-determinism.md)).
- `step(1)×N == step(N) == step(10)×N/10`.
- save → load → continue equals uninterrupted play.
- A `(tick, cmd)` log replays to identical checkpoint hashes.

**Look and feel** ([ADR 0009](decisions/0009-render-isometric-threejs.md),
[ADR 0013](decisions/0013-rendering-and-art-pipeline.md)).
- Fixed isometric orthographic camera: pitch 35.264°, six 60° yaw steps, zoom 0.75–24 px/m.
- A stylised Baltic countryside around 1900 on a late-summer morning: procedural low-poly
  terrain, track, bridges, trees, buildings and steam puffs. The palette is original and
  drawn from public-domain 1900 Baltic sources.
- The base look works without post-processing. Rendering is on demand, so an idle scene
  renders zero frames.
- Readable at three zoom levels. The owner judges mood and feel (§7).

## 3. Explicit exclusions

| Not in M4 | Where it goes |
|---|---|
| Towns, settlements, industries, demand, passengers, cargo | M5 |
| Economy and money | Not scheduled; M5 at the earliest. Subsidies never |
| Roads, level crossings, road traffic | M6 |
| Persistent saves (IndexedDB) and any save/load UI | M5. M4's `save()`/`loadSim()` serve replay fixtures and tests only. Never write to the legacy database `infrastructurio` |
| Player lines, timetables, dispatch, train purchase, fleet management | Never (player role) |
| Mixed stock, several operators, competition | M5 or later; the M4 operator is a placeholder (ADR 0014) |
| Sound, day/night, weather | Not scheduled |
| Terrain editing | Not scheduled; M4 terrain is static and seeded |
| Off-lattice geometry, clothoids | Deferred; precision mode stays on the lattice |
| Double slips | Deferred (`double-slip-unsupported`) |
| WebGPU, simulation in a Web Worker | Main thread until measured. A preview p95 above 8 ms triggers a Worker ADR |
| glTF assets | Later, registered against the same `AssetRegistry` keys; procedural stays as the fallback |
| Touch input, a screen-reader map | Known accessibility gaps |
| First-time-player validation | M5 |

## 4. Architecture in brief

[Architecture](architecture.md) has the full picture.
- `src/core` is the deterministic, DOM-free simulation, typechecked by `tsconfig.core.json`.
- `src/tools` holds pure tool reducers.
- `src/render` is imperative Three.js.
- `src/ui` is a React 19 HUD outside the frame loop.
- `src/app` wires them together with a fixed-step host loop.

`tests/architecture.test.ts` enforces the boundaries by scanning sources, with a negative
self-check. Commands carry resolved pieces, not drag input, so planner tuning never breaks a
replay. The renderer interpolates between the previous and current tick and never
extrapolates, so a train never visibly overshoots a red signal.

## 5. Delivery and slice ladder

**Reset sequence.**
[#59](https://github.com/Kminkjan/infrastructurio/pull/59) (road-era handoff) → tags
`legacy-m0-m4`/`legacy-m3` → [#60](https://github.com/Kminkjan/infrastructurio/pull/60)
(reset + skeleton) → [#61](https://github.com/Kminkjan/infrastructurio/pull/61) (docs,
architecture, ADRs 0009–0014, the CLAUDE.md set, [`AGENTS.md`](../AGENTS.md) and the
predeclared acceptance gates; the planned PRs 2–4 combined) → one PR per slice. The owner
merges every PR personally, and approves the gates file explicitly, separately from the
merge, exactly as its rule 1 says.

**Slices.** The design splits into core slices S0–S12 and render slices R0–R7. The backlog
groups them into thirteen tracking keys:

| Key | Core slices | Render / UX slices | Human check |
|---|---|---|---|
| D1 | S0 utils (boundary test on main), S1 lattice (on main), terrain | R0 foundation, R1 terrain, lighting, lattice shader | — |
| D11a | Scenario scenery | R3 scenery kit + static diorama | **Look Gate A** |
| D2 | S2 templates/piece/sample, S3 authored/validate/clearance/history | — | — |
| D3 | S4 planner | R2 track meshes, R4 construction tool | Early owner feel check |
| D4 | Structure inference and rules | Bridges, portals, earthworks, H/U views | — |
| D5 | S5 turnouts, fans, conflict groups | Switch timbers, animated blades | — |
| D6 | S5 platforms, stations, depots | R5 station, depot and demolish tools, buildings | — |
| D7 | S5 blocks, signals, one-way rule, aspects | R5 signal tool, semaphores, block overlay | — |
| D12 | S12 harness: invariants, save, hashes, bench | PerfMonitor overlay (F3), Playwright bench | — |
| D8 | S6 pathfind, S7 trains, S8 reservation | R6 vehicles, bogies, steam, reservation overlay | — |
| D9 | S9 deadlock + reasons, S10 operator | Notifications | — |
| D10 | S11a/b edits under traffic, `inspect` | R6 inspector with Show, EntityList, time controls, HUD | — |
| D11b | — | R7 hardening: presets, dynamic resolution, context loss, budgets | Prepares Look Gate B |
| D13 | Automated evidence | Bench evidence | Owner walkthrough = **Look Gate B** |

**Two lanes, in parallel.**

```
core    D1 → D2 ─┬→ D3 planner → D4 rules → D5 → D6 → D7 ─┬→ D8 → D9 → D10
                 └→ D12 harness ──────────────────────────┘
render  D1 → D11a (Look Gate A) → D3 → D4 → D5–D7 halves → D8 → D10 → D11b
gate    D1–D12 → D13 (automated and performance gates; owner walkthrough = Look Gate B)
```

- **Recommended order:** D1 → D11a → D2 → D3 → D4 → D5 → D6 → D7 → D12 → D8 → D9 → D10 →
  D11b → D13. D11a runs beside D2, and D12 beside D5–D7.
- **Integration:** a render half consumes its core half only through `NetworkView` and
  `FrameView` snapshots and the pure `geometry/sample.ts`. It can start against hand-built
  snapshots and integrates once the core half is merged.
- **One agent at a time** touches `src/core/track`, `src/core/signals` and
  `src/core/trains`. Render, art and harness work may run in parallel with it.
- **PRs per key:** a key may ship as more than one PR (typically core half, then render
  half). PRs reference issues as `Related #N` and never use closing keywords.
- **Salvage:** read road-era code at the tag and re-implement it; never copy it. This
  covers the preview/execute/single-reason pattern, the invariant and replay fixture style,
  and ray-plane picking. See [the archive](archive/README.md).

**Per-PR definition of done.**
- `npm test`, `npm run typecheck` (both configs), `npm run build` and
  `git diff --check origin/main...HEAD` pass, with exact counts reported.
- UI slices add Playwright e2e through a projection hook, labelled as agent evidence.
- D1, D3, D8 and D11 add a manual browser check (`npm run dev`) that names exactly what was
  exercised. Anything skipped is said out loud.

## 6. Acceptance gates overview

The gates are predeclared in the PR that adds the gates file (#61) and approved by
the owner **before any measurement**. They are never retuned after results. The
authoritative text is the [acceptance gates record](evidence/m4/2026-09-26-acceptance-gates.md);
this is a summary.

**A. Automated** (agents record exact counts).
- Unit and property tests, with one negative fixture per reason code.
- Safety soak: 50 seeded layouts × 10 simulated minutes, with 0 double-held sections, 0
  signals passed at danger and 0 overlaps.
- Determinism: 3 golden fixtures × 1 simulated hour. Checkpoint hashes must be identical
  across fresh processes and across save/load at the halfway point.
- Undo: every command type round-trips.
- The boundary test, both typechecks, the build and `git diff --check` pass.

**B. Performance** (provisional numbers, approved by the owner before the first run).
- Reference scene `bench-m4`: about 900 pieces, 24 turnouts, 120 signals, 6 stations,
  2 depots, 3 bridges, 2 tunnels, 15k trees, 150 buildings and 24 trains.
- Headless simulation: tick p95 ≤ 0.5 ms, 10-tick batch p95 ≤ 3 ms, preview p95 ≤ 4 ms,
  commit p95 ≤ 25 ms.
- Browser on Apple M5 Pro, High preset, DPR 2:
  - frame p95 ≤ 16.7 ms (p99 ≤ 25 ms), CPU per frame ≤ 3 ms;
  - ≤ 150 draw calls at Default zoom (≤ 250 at Far);
  - rebuild after a 10-piece edit ≤ 3 ms;
  - no leaks over 200 edit/undo cycles;
  - initial JS ≤ 350 KB gzip.
- Mid laptop (Intel i5-1235U/1335U with Iris Xe, or Ryzen 5 7530U; 1080p; Medium preset):
  measured, or recorded as "deferred, not passed".
- Method: p95 = s[floor(0.95·n)]. Missing samples are null, and GPU time is "n/a" where it
  is not exposed. `bench/budgets.json` is committed before the first run.

**C. Owner walkthrough** (human only; agents never perform, simulate or narrate it). From
empty terrain the owner:
1. orients: pans, zooms through Region, Default and Close, rotates once with Q/E;
2. builds an oval with a passing loop and 2 stations;
3. adds a branch that climbs over the main line on a bridge;
4. adds a tunnel;
5. adds signals and a depot;
6. watches at 1× and 4×;
7. inspects a waiting train;
8. tries demolishing occupied track.

The owner records Look Gate B: palette, charm, cohesion and originality re-scored, plus
mood, readability at 3 zoom levels and construction feel, and any friction. C passes only
when all eight steps are completed.

**Records.**
- Dated files under `docs/evidence/m4/` cover the automated run, performance, the owner
  walkthrough and the disposition.
- Each file states the SHA, environment, commands, counts, raw JSON and non-claims.
- Each observation is labelled automated, agent, owner or participant. Automation is never
  human evidence.

**Disposition.** D13 runs the gates, records the walkthrough the owner performed, and
publishes a *recommended* disposition. M4 completes only when the gates are recorded and
the owner explicitly accepts. The owner decides, and GitHub records the outcome.

## 7. Look gates (owner-only)

Only the owner scores a look gate. Agents prepare the views and record the owner's words
verbatim. They never score, simulate or paraphrase a verdict into a pass.

**Look Gate A**, at the end of D11a (static diorama, no trains).
- The owner compares four bookmark views of the static diorama with the mood board.
- They score a 1–5 rubric: **palette, charm, legibility, cohesion, originality**.
- They also judge an A/B of the camera pitch: 35.264° against 30°, a single constant.
- The mood board links the reference game's Steam page and public-domain sources. No
  captures of the reference game enter the repo.
- **If the owner does not pass it:** iterate on palette, lighting and kit inside the D11a
  time-box before D11b spends effort on polish.

**Early owner feel check**, in D3. This is not a gate: the owner tries the construction tool
before D4–D7 build on the planner. Planner changes stay cheap at that point, because the
template table is data.

**Look Gate B** is the owner walkthrough (§6 C), held in D13 on the D11b build.

## 8. M5 contract (outline)

**M5 — Autonomous Rail Serves a Growing Region**
([milestone 9](https://github.com/Kminkjan/infrastructurio/milestone/9); placeholder epic
[#63](https://github.com/Kminkjan/infrastructurio/issues/63)).

> Settlements and industries create demand; autonomous operators start, adjust and withdraw
> services with explanations; rail access shapes growth; growth creates the next capacity
> problem; save/replay and a first-time-player session. This is the first integrated
> playable loop.

- **Replaces:** the M4 placeholder headway and single operator (ADR 0014). Operators are
  demand-driven and still autonomous and explainable.
- **Adds:** persistent saves under a new IndexedDB database name, never `infrastructurio`.
  It also adds a first-time-player session labelled participant evidence, separate from any
  owner session.
- **Still excluded:** player lines, timetables, dispatch and fleet purchase (never), and
  roads (M6).
- **Planning:** starts after the M4 disposition. Its gates are predeclared in the same way
  before any measurement.

## 9. M6 contract (outline)

**M6 — Roads Feed and Compete with Rail**
([milestone 10](https://github.com/Kminkjan/infrastructurio/milestone/10); placeholder epic
[#64](https://github.com/Kminkjan/infrastructurio/issues/64)).

> Lattice roads with lane presets and priorities, level crossings and grade separation,
> road access to stations, causal road traffic, mode choice, constrained town streets.

- **Source material:** the road-era research at tag `legacy-m0-m4` and ADR 0003's
  principles (one physical vehicle per entity, capacity from occupied space). Read them at
  the tag and re-implement; road-era evidence is history, not current evidence.
- **Still excluded:** any player control of vehicles or services.
- **Planning:** after M5 evidence.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Planner feel falls short of the continuous follow in the mood reference | Early owner feel check at D3; chained drags; an auto-waypoint fallback; the template table is cheap to extend |
| Art becomes a time sink | Procedural only, one palette module, Look Gate A early, D11b time-boxed |
| The look drifts too close to the reference game | Public-domain sources; no reference captures in the repo; originality is scored at Look Gate A |
| Signalling and deadlock complexity | Deadlock is detected and explained, not prevented; soft-want FIFO so nothing starves; soak invariants from D8 onward |
| Edits while trains run corrupt state | S11a first (reject any edit touching a held section), then the committed-zone refinement (S11b) |
| Floats drift between JavaScript engines | Integer units, no trig in the step, clearance decided only at commit time and never re-validated on load (ADR 0012) |
| Main-thread budget on the mid laptop | Render on demand, auto-preset drop, dynamic resolution; preview p95 > 8 ms triggers a Worker ADR |
| Occluded picking under bridges and in tunnels | Layer-filtered proxy picking, H/U/C aids and a keyboard EntityList; the lesson recorded against ADR 0004 |
| The placeholder operator is mistaken for the design | Placeholder label in the inspector; ADR 0014 scopes it to M4; M5 replaces it |
| Gates are bent to fit results | Gates are predeclared and owner-approved before measurement and never retuned; misses are recorded as misses |
| Losing history or deleting M3 by accident | Annotated tags, re-verification at the tag, no force-push, tag links in every closing comment |
| Parallel agents build on stale road-era work | [`AGENTS.md`](../AGENTS.md), which routes other agents to [`CLAUDE.md`](../CLAUDE.md); PRs whose base predates the reset are re-implemented, never merged |

## 11. Non-claims

- This plan is preparation. It is not evidence that any gate passed, any slice works or M4
  is accepted.
- ADRs 0010–0014 are Proposed. Merging them does not accept them.
- Numbers here are provisional until the gates PR predeclares them with owner approval.
- Mighty Tiny Railways is a mood reference only. No assets, names, UI or screenshots are
  copied from it.
