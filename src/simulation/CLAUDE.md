# src/simulation — legacy M0–M2 core (Millford Valley)

This is the live code behind the Millford app (`src/app/App.tsx`) and v3 saves. It is **legacy** for M4/M5: its last behavioural change was on 2026-08-23. **Fix bugs here, but never grow it into the M4/M5 model** (lanes, curves, elevation, vehicles, trips, land uses).
- **Legacy status:** `docs/research/m4/legacy-inventory.md` marks its planar topology, aggregate capacity/congestion and generalized-cost accessibility for replacement, and says never to reinterpret its hour ticks as movement ticks. #50 adds that legacy topology, scenario state and save slots must not constrain the construction model.
- **Reuse patterns, not code:** typed commands, frozen snapshots, seeded decisions, explanations derived from decision inputs, behavioural tests. Never import this code into `src/experimental/construction` or `experiments/m4`.
- **M3 is not here.** The M3 files named in the inventory exist only on `origin/codex/issue-19-release-gate`; read them with `git show`. Never open the protected checkout path the inventory cites.

## Boundaries
- Import only `../shared` and `../scenarios`. No React, Pixi, DOM, `Math.random`, `Date` or timers.
- `tsc` includes DOM libs, so the only headless guard is `expect(globalThis).not.toHaveProperty("document")` in `simulation.test.ts`.
- **API** (`index.ts`): `createSimulation(seed)` / `restoreSimulation(state)` return `{dispatch, getSnapshot, getState, findRoute}`.
- **Where persisted types live:**
  - The wrapper types (`SimulationStateSnapshot`, `RoadTrafficStateSnapshot`, `DevelopmentStateSnapshot`) live beside their reducers here.
  - Their leaf types `RoadSegment`, `RoadClass`, `Point` and `PendingConstruction` live in `src/shared` and are persisted too.

## Time and units
- 1 tick = 1 simulated hour (`TICKS_PER_DAY = 24`); ticks are non-negative safe integers.
- **Traffic** reassigns every 8 ticks **and after every network-changing edit**. An edit re-phases the cadence to editTick + 8.
- **Development** evaluates on absolute multiples of 168 ticks (`growth/millford-development.ts`):
  - Construction takes 168 ticks, and a project adds up to 10 residents (capped by remaining regional demand).
  - A site with growth and pressure ≤ 0 loses 5 growth residents per evaluation. Base population never declines.
  - The regional cap is 100. Base populations are Millford 60 and Eastbank 40, with land cost 35 each.
- **Units:** map units (960×620); speed in map units/hour; cost in generalized **hours**; flow in units/day (1 unit = 1 requested ton/day). Keep unit suffixes: `…Tick`, `…Hours`, `…UnitsPerDay`, `…TonsPerDay`, `…Points`.

## Determinism
- **Randomness comes only from the seed:**
  - scenario geography, regenerated on every create *and* restore;
  - the stateless `seededUnitValue(seed, evaluationNumber)` in `growth/development.ts`.
- **Order dependence:**
  - Dijkstra breaks cost ties by `localeCompare` on node and link IDs; explanations break ties by candidate ID.
  - Separately, the seeded selection walks candidates in model order (Millford, then Eastbank), so reordering them changes outcomes. Preserve both.
- **Replay contract:** same seed + same ordered commands + **identical `advance` sizes**.
  - `advance(n)` ≠ n × `advance(1)`: traffic runs at every crossed boundary, but every weekly evaluation inside one `advance` uses the accessibility from that advance's final tick.
  - The difference shows once accessibility changes between evaluations. A probe with a competing bypass diverged on 24 of 60 seeds; single-route networks did not diverge.

## State, commands, snapshots
- **Commands:** `advance | reset | build-road | upgrade-road | remove-road`.
  - Invalid input throws `RangeError` before state changes.
  - Some tests pin exact messages and some only the error class. Don't reword existing messages, and assert exact messages in new tests.
- **`getState()` is the persisted authority; `getSnapshot()` is derived.** A new state field is **not saved** until `src/persistence` reads it: `validateSaveGame` silently drops unknown keys.
- **Identity semantics:**
  - No-op reducer paths return the same objects: `upgradeRoad` on a highway, `removeRoad` on an unknown ID, `advanceRoadTraffic` before a boundary, and `reconcilePendingConstruction` with nothing to cancel.
  - `simulation.ts` compares `roadNetwork` with `!==`. A new-but-equal network therefore re-phases the cadence and erases congestion.
  - `getSnapshot()` and `getState()` build fresh wrappers on every call, so never rely on snapshot identity. Outputs are hand-frozen.
- **Reset:** `reset` returns to the construction-time state. After `restoreSimulation`, that is the loaded save, not tick 0.
- **Unknown IDs:** `upgrade-road` throws; `remove-road` is a silent no-op. An upgrade always jumps straight to highway.
- **Save compatibility.** Each of these breaks v3 saves:
  - changing a persisted shape (`validateSaveGame` / `validateDevelopmentState` reject it);
  - changing how node or link IDs are *generated* (`road-node-N`, `<segmentId>:link-K`), including segment order, `EPSILON` and the split/dedupe logic in `createRoadNetwork`, even as a "geometry fix";
  - changing the 8-tick interval;
  - changing the 100-unit flow.

  `restoreRoadTraffic` rejects the last three because saved routes store derived IDs. Each change needs a `SAVE_FORMAT_VERSION` bump to **10 or higher**: never 4–9, which the unmerged M3 branch owns (see `src/persistence/CLAUDE.md`).
- **Tuning is a save-contract change.** Some tuning silently changes what saves mean (road-class profiles, access weights, decay). Some makes saves unloadable (quarry/market positions, settlement IDs, map bounds, a lower regional cap).

## Transport
- **Graph:** rebuilt from the ordered authored segments on every edit (pairwise O(n²)). Every 2D crossing becomes an at-grade node; collinear overlap throws. Only segment IDs are stable.
- **Connectivity:** a place is connected only if a node lies within 1e-7 of its exact position. Snapping belongs to the renderer; `build-road` only clamps and rounds to 0.001.
- **Freight assignment:** a single freight origin–destination pair, assigned all-or-nothing on the *previous* assignment's costs.
  - The post-edit assignment uses **free-flow** costs, so edits erase congestion memory.
  - Link flow stays 100 units even when shipped tons are cost-limited or zero.
- **Route oscillation:** competing routes flip at every assignment, including the documented highway-bypass fix. Current tests pass only because they sample after an odd number of assignments.
  - Assert at a known parity.
  - The oscillation is untracked on GitHub (checked 2026-09-26), so file a bug before fixing it.
  - A route-choice fix that keeps one route, the 100-unit flow, the 8-tick cadence and the ID generation needs no format bump. Say so in the PR.
- **Delay and bottlenecks:** delay = t0 · 0.5 · ((v/c)⁴ − 1), applied only when v > c. A bottleneck is flow > capacity + 1e-7.

## Growth
- **Accessibility scorer:** the only stateful object, a closure cache outside `SimulationState`. It is rebuilt on reset and restore, and its fingerprint includes generalized cost.
  - `lastNetworkUpdateInvalidatedLocationIds` depends on history, so across a restore compare `.accessibility.locations`, not whole snapshots.
- **Score** = Σ weight · exp(−hours / 10), rounded to 0.001. A candidate with no node on its own position scores 0 even for its own labour and services, which gives pressure −35.
- **Pending projects:** edits cancel non-viable ones, and so does the start of every `advance` (checked against its final-tick accessibility). Growth and decline happen only at weekly evaluations.
- **Status:** pending → `growing`; pressure ≤ 0 with growth → `declining`; pressure ≤ 0 without growth → `pressured`; otherwise `stable`.
- **Explanations** come from the same values as the decision. Tests check that contributions minus land cost equal pressure, and that shares sum to 1.

## Tests
- **Header:** line 1 is `// @vitest-environment node`. Import `describe`/`expect`/`it` from `vitest`. No globals, mocks, fake timers or snapshot files.
- **Fixtures:** local fixture builders, a descriptive seed per test, and positions read from `snapshot.geography`. Determinism = two instances with the same seed and commands, compared with `toEqual`.
- **Pure modules:** unit-test them with small synthetic models, not Millford constants.
- **While iterating:** run `npx vitest run src/simulation src/scenarios src/persistence src/rendering`, since rendering tests embed simulation IDs and labels. The finish gate is the root CLAUDE.md Definition of Done.
