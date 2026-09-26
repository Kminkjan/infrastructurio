# src/persistence — Millford save format (legacy v3 lineage)

From M5's point of view this module is legacy. Treat existing save payloads as user data. M4 implements no new persistence; the new-model save policy belongs to M5 #38.

## What a save is
- The shape is `{formatVersion, scenarioId: "millford-valley", scenarioSeed, simulation}`, with `SAVE_FORMAT_VERSION = 3`.
  - v1: tick, roadSegments (no class), nextRoadSegmentNumber.
  - v2: adds `development`.
  - v3: adds `roadClass` and `roadTraffic`.
- **Persist only authored or mutable state:** the seed, tick, roadSegments **in saved order**, nextRoadSegmentNumber, and the development and road-traffic snapshots.
  - Never persist derived data (geography, nodes, links, costs, accessibility, freight, bottlenecks, explanations) or presentation state.
  - A new simulation state field is lost on save until the validators here read it.
- **Geography** is regenerated from `scenarioSeed` by `generateMillfordValley`, so the generator is part of the save contract (`src/scenarios/CLAUDE.md`).
- **Saved routes hold derived graph IDs.** `roadTraffic.routeNodeIds` and `routeLinkIds` come from `createRoadNetwork`.
  - Never sort, dedupe or re-ID segments.
  - Never change node/link ID generation without a format bump. A reversed segment list makes a valid save unloadable.
- **Restore requirements**, enforced by `createSimulationState`, `restoreRoadTraffic` and `validateDevelopmentState`. Changing any of them is a format change:
  - **Saved route:** it must resolve on the rebuilt network and run quarry → market, with flow === 100 (min of quarry 120 and market 100).
  - **No saved route:** flow must be 0, and the rebuilt network must have no quarry → market route.
  - **Traffic cadence:** `lastAssignmentTick ≤ tick < nextAssignmentTick` and `next − last === 8`.
  - **Development:** `development.processedTick === tick`; the locations are exactly the scenario's settlement IDs; completed plus pending growth ≤ 100.
  - **Roads:** inside 960×620, with unique non-empty IDs, and `road-segment-<next>` unused.

## Validation: keep both stages on every path
1. **`validateSaveGame`:**
   - a strict `===` version whitelist, a literal scenarioId and safe-integer minimums;
   - returns a NEW deep-frozen object and silently drops unknown keys (the M5 policy forbids copying that behaviour);
   - defaults a missing or `null` `roadClass` to `"arterial"` for *every* version;
   - throws `SaveGameError` with field-specific messages for invalid fields.
2. **`restoreSaveGame`:**
   - re-runs `validateSaveGame`, whose errors propagate unwrapped;
   - then wraps any `restoreSimulation` throw as `SaveGameError("save contains invalid simulation state", {cause})`.
- **Every path validates.** Serialize, IndexedDB put/get and file read all call `validateSaveGame`. Never pass unvalidated data to `restoreSimulation`, and never load a save partially.
- **Migration is split between modules:**
  - `restoreSaveGame` maps v1 → `development: undefined` and v1/v2 → `roadTraffic: undefined`.
  - `validateSaveGame` supplies the `roadClass` default.
  - `createSimulationState` in `src/simulation/simulation.ts` builds fresh development and re-assigns traffic at the saved tick. So changing `createDevelopmentState` or `createRoadTraffic` changes what v1/v2 saves load as.
  - `createSaveGame` always writes the current version, so upgrades are one-way.

## Bumping the format (only for incompatible state or rule changes)
- **NEVER use versions 4–9 for `"millford-valley"`.** The unmerged M3 branch defines them with the same scenarioId, file name and slot. The next version is **10 or higher**.
  - Read that branch with `git show origin/codex/issue-19-release-gate:src/persistence/save-game.ts`.
  - Never open `/Users/krisminkjan/Documents/CodexRepos/infrastructurio`.
- **Types:**
  - Make the previous interface's `formatVersion` a literal, and add `SaveGameVn`.
  - Extend the union and the barrel's type exports (`SaveGameV3` is currently missing from `index.ts`).
  - Update `createSaveGame`'s `SaveGameV3` return type and its `as SaveGameV3` cast.
- **Hard-coded checks:** update the whitelist, the `formatVersion: 3` in `validateSaveGame`'s last branch, and the `=== SAVE_FORMAT_VERSION` roadTraffic check in `restoreSaveGame`.
  - **Shape-only bump:** extend that last check to cover v3. Otherwise v3 saves silently discard their saved traffic and re-assign it.
  - **Rule bump that invalidates saved routes** (node/link ID generation, the 8-tick interval, the 100-unit flow): v3 `roadTraffic` can no longer pass `restoreRoadTraffic`. Deliberately discard and re-assign it for v1–v3, and say so in the PR.
- **Tests:**
  - Keep all older versions loadable, with a "loads version N saves" test.
  - For a shape-only bump, build that test inline from `createSaveGame` output. For a rule bump, that output already follows the new rules and would hide the break, so commit a JSON save generated before the change and load that.
  - **Keep** the version-4 rejection test (M3's v4–v9 must stay rejected), and add one for version N+1.
- **Docs:** update the "Save format" section of `docs/technical-architecture.md`.

## IndexedDB slot (shared with the M3 v9 build)
- **The slot:** database `infrastructurio` v1, store `saved-games`, key `m0-scenario`. `put` replaces the stored value.
  - The M3 build uses identical names and version, so "Save local" here overwrites a v9 save.
  - Loading a v4–v9 save throws and writes nothing.
- **Never rename** the database, store or key; never bump `DATABASE_VERSION`; never add clear or delete. The names look stale but are load-bearing.
- **Export file:** `millford-valley-save.json` is also shared with the M3 build; only `formatVersion` tells the files apart.
- **M5 policy (#38; proposed in `docs/research/m4/legacy-inventory.md`, not implemented):**
  - The new model gets its own scenarioId *and* database namespace before any write.
  - Legacy storage is read-only.
  - Keep the original import bytes.
  - Reject unsupported versions without writing.
  - Test v3/v9 coexistence and non-overwrite.

## Tests (`npx vitest run src/persistence src/scenarios`)
- **Header and imports:** line 1 is `// @vitest-environment node`. Import from `"."`, and assert exact error strings.
- **IndexedDB:** `import { IDBFactory } from "fake-indexeddb"`, and pass a fresh `new IDBFactory()` per test as the `factory` argument. There is no `/auto` import and no setup file.
- **Downloads:** inject a fake document and URL, and use `vi.useFakeTimers()`, since the revoke runs in `setTimeout(0)`.
