# src/core — deterministic, DOM-free simulation

The simulation is authoritative (ADR 0002): everything else reads its snapshots and sends it
commands. Status 2026-09-26: `lattice.ts`, `terrain.ts` and `util/` (+ tests) exist (D1);
`geometry/` (templates, piece, sample, clearance), `track/` (authored, validate, history),
`network/derive.ts` and `sim/` (`world.ts`, `api.ts`: build, demolish, undo, redo, preview,
network) exist (D2); later slices add the rest
([simulation model](../../docs/simulation-model.md), [architecture](../../docs/architecture.md)).
ADRs 0010 (lattice geometry), 0011 (signalling), 0012 (tick and determinism) and 0014
(operator) are **Proposed**: their numbers are defaults to test, not owner decisions. The
critical rules below stand alone; repo-wide rules are in the root [CLAUDE.md](../../CLAUDE.md).

## Boundary and determinism: enforced

`tests/architecture.test.ts` scans every non-test file here (comments stripped; `*.test.ts`
and `*.bench.ts` exempt), and `tsconfig.core.json` compiles it with lib ES2022, `types: []`
(no DOM, no Node), `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **Import nothing outside `src/core`**, and no packages at all: any non-relative import fails.
- **Forbidden:** `Math.random`, `Date`, `performance.`, `console.`, `window`, `document`,
  `globalThis`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `structuredClone` and
  `for…in`. The scan is textual and keeps strings: `"Date"` in a literal or a field named
  `window` fails too, so name FrameView's section window e.g. `sectionWindow`.
- **Transcendental `Math`** (sin, cos, tan and their inverses and hyperbolics, atan2, pow,
  exp, expm1, log*, hypot, cbrt) only in `geometry/{sample,clearance,templates}.ts`.
  `templates.ts` is the only place π/atan generate geometry; `sample.ts` is render-only
  sampling; `clearance.ts` floats decide only at commit time, and saves never re-validate.
- Never weaken the scan or its negative self-check to get green; fix the code. A new rule
  gets a scanner line **and** a self-check case.

## Determinism: by review (not scanned)

- **The step is integer-only** (mm, dm, ms, mm/s, mm/s²). Use `util/int.ts`: exact `isqrt`
  (`floor(Math.sqrt)` plus correction) and `divFloor`. Never divide without flooring, never
  use `**` (it is `Math.pow` by another name), no bitwise ops on values that can pass 2³¹.
  The designed largest intermediate is about 1.2e9.
- **Constants:** use `SQRT3` and the step and unit tables in `lattice.ts`; never recompute
  `Math.sqrt(3)` or derive a direction with trig outside the whitelist.
- **Order independence:** Map/Set insertion order and edit order never decide IDs or
  outcomes. Sort by canonical key before assigning IDs (`derive` sorts pieces by key) and
  break every tie explicitly: paths by (cost, dirSectionId), reservations by
  (firstRequestTick, trainId), movement by trainId.
- **Randomness:** `util/prng.ts` (sfc32) only for seeded scenario and test generators, never
  in the step. **Time:** the host calls `step()`; the core never sees wall time.
- **Hashing:** `util/hash.ts`, FNV-1a over canonical JSON (sorted keys).
- **Engines:** the sim step must hash identically on every JS engine; only construction
  clearance at exact thresholds may be engine-pinned.

## Units

- Lengths and track positions: integer **mm** (`lengthMm`, `headMm`). Lattice a = 5000 mm;
  a secondary step is 8660 mm (`stepLengthMm`).
- Elevation: integer **mm** per node (`zMm`, `z0Mm`, `z1Mm`); terrain stays Int16 dm and
  converts at its boundary. Node identity is (q, r, zMm). Max grade 35‰ (175 mm per 5 m).
  Settled as a default on 2026-09-26 (#66 amendment,
  [ADR 0010 D2 finding](../../docs/decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-26-d2-track-model));
  ADR 0010 stays Proposed.
- Time: **1 tick = 100 ms (10 Hz)**; `simMs`, path costs, dwell and timeouts in integer ms
  or ticks, never float seconds.
- Speed **mm/s** (`speedMms`; 60 km/h = 16,666), acceleration **mm/s²**.
- Plan metres from `toWorld`/`nearestNode` are floats for render and snapping only: never
  store them in state, commands or saves. Display units (m, km/h, %) appear only in messages.

## API and command rules

- **Public surface = `sim/api.ts`:** `createSim(scenario)`, `loadSim(save)`, and `Sim { tick,
  planTrack, preview, execute, step, network, frame, inspect, save }`. Render, tools and ui
  import only it plus `geometry/sample.ts`, so export new helpers through it.
- **Commands carry resolved pieces, never drag input:** `build-track`, `demolish`,
  `place-signal`, `place-platform`, `place-depot`, `undo`, `redo`. `planTrack(drag)` stays
  separate, so planner tuning never breaks a replay.
- **Commands are infrastructure only:** never add a command, field or API that buys, spawns,
  assigns or routes trains, or sets lines, timetables, headways or dispatch (player role;
  ADR 0014 §9). The operator derives all of it.
- **`preview` and `execute` share one code path.** Preview never mutates and consumes no
  IDs.
- **One reason per rejection:** the first failing rule in the fixed order structural →
  geometry → grade → terrain/structure → node topology → clearance → entities → operational,
  plus highlight refs. Reordering rules changes fixture outcomes, so it needs an ADR update.
- **Reason codes are stable kebab-case** (`radius-too-tight`, `track-in-use`). Never rename or
  reuse a shipped code; a new code gets a negative fixture and an entry in the
  [simulation model](../../docs/simulation-model.md).
- **Messages suggest the fix, with numbers:** `grade-too-steep` gives the required length;
  `track-in-use` names the trains and pieces.
- **Player-reachable input never throws;** it returns `{ok: false, reason, highlight}`. Throw
  only for programmer errors and invariant breaches.
- `Result` is `{ok: true, networkRev, diff, counts {new, reused}}` or `{ok: false,
  reason {code, message, refs}, highlight}`. An all-reused build is a no-op with no history
  entry.
- **Snapshots are read-only:** `NetworkView` is cached per `networkRev` (the same object until
  the revision changes); `FrameView` comes every tick, typed arrays (`signalAspect`,
  `sectionHolder`) included. Consumers never mutate them.
- **Switches are set only by reservation,** when a granted route crosses a turnout
  (`FrameView.switchLeg`). No command or tool sets a switch: that would be player dispatch.

## Identity

- **Geometry identity is the canonical piece key,** normalized so the smaller end comes
  first: `S:q,r,z0:d:z1`, `C:q,r,z0:d:turn:R:variant:z1`, `H:q,r,z0:d:side:z1`. "N new, M
  reused" is a key lookup; commands and history reference pieces by key.
- **Derived IDs** (nodes, sections, blocks, conflict groups) are assigned after sorting by key
  and hold for one `networkRev`: never persist them or put them in commands.
- **Monotonic allocators** (stations, trains, lines) never roll back: not on undo, not on a
  rejected command, never in preview. Station names index a Baltic list by ID.
- **History** (depth 100) holds construction diffs only. Trains, time, the operator and the
  allocators are never in history, so undo cannot create an ID hazard.

## Invariants (`sim/invariants.ts`)

Checked every tick in tests, every 100 ticks in dev, off in production; a breach throws with
the tick and the IDs involved.
- sections and conflict groups are held exclusively; occupied ⊆ held; no orphan holdings;
- head ≤ end of authority; speed ≤ limit; train length constant; no train on missing pieces;
- spawned = active + despawned + withdrawn; `derive(authored)` equals the cached network.

## Testing idioms

- Vitest in Node, co-located `*.test.ts`; benches are `*.bench.ts` (`vitest bench`). Both are
  outside `tsconfig.core.json` and typecheck under the app config.
- **Seeded `forAll`:** one small in-repo helper at `tests/support/forall.ts` (D12 owns it; an
  earlier slice that needs it creates it there); no fast-check or other new dependency. It
  prints the seed and case on failure. Seed every generator (sfc32); no `Math.random` in tests.
- **Properties:** derive is order-independent; preview == execute without mutation; undo/redo
  round-trips; shuffled movement order keeps the hash; random networks run 10k ticks with
  invariants every tick; random edits during traffic keep them.
- **Replay equalities:** `step(1)`×N == `step(N)` == `step(10)`×N/10; save → load → continue
  == uninterrupted play; the `(tick, cmd)` log replays to identical checkpoint hashes. On a
  mismatch, diff the canonical JSON, not just the hash.
- **Golden scenarios are built via commands only** (`createSim` + `execute`), never by
  constructing state: shuttle capped at 1; passing loop with 2 trains and no deadlock over 2
  simulated hours; blocked exit, stop vs chain; FIFO at a junction; diamond; grade and curve
  speed profile (balancing speed 10.5–11.5 m/s on 35‰); edit while running; loop line;
  unreachable station; two-platform station; forced deadlock (detected ≤ 30 s, withdrawn at
  120 s, then `capped-deadlock`).
- **One negative fixture per reason code,** minimal enough that no earlier rule fires. Core
  exports its codes as a runtime list, and a coverage test fails when a code has no fixture
  or a fixture returns an unlisted code.
- **Bench budgets** in `bench/budgets.json` equal the acceptance gates, are committed before
  the first run, and are never loosened after results.

## Performance

**Profile before optimizing.** Stay on the main thread with plain data until a bench shows a
budget miss: no Worker, WASM, pooling or extra cache without a measurement in the PR. If
preview p95 > 8 ms, propose a sim-in-Worker ADR. Budgets are authoritative only in the
[acceptance gates](../../docs/evidence/m4/2026-09-26-acceptance-gates.md).

## Working here

- One agent at a time edits `track/`, `signals/` or `trains/`.
- Salvage by reading, never copying: `git show legacy-m0-m4:src/experimental/construction/model.ts`
  (preview/execute, one reason, frozen snapshots) and
  `git show legacy-m0-m4:experiments/m4/lane-fixture.mjs` plus its `.checks.mjs` (invariant,
  replay and blocked-exit style). Never cite their evidence.
- Before pushing: `npm run check` (tests, both typechecks and the build) and
  `git diff --check`; the full definition of done is in the root CLAUDE.md.
