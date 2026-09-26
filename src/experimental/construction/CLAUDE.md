# src/experimental/construction — M4 construction proof (#50–#55)

This is an isolated research proof, not production code.
- ADRs 0005 (grid/curves), 0006 (identities/edits) and 0007 (SVG editor) stay **Proposed** until the owner explicitly accepts them.
- The current contract and dated evidence are in `docs/research/m4/construction-controls.md`.
- `construction.md` is the historical #51 record: its "Commands and snapshots" section is stale, and it already points to the newer doc. Don't rewrite it.
- New findings go in a new dated `— YYYY-MM-DD (still Proposed)` section of ADR 0006. Never edit the 2026-09-07 section.

**Scope** (from the handoff and orchestration ledger):
- Extend this model and editor, and fix #52/#53 recovery defects before expanding scope.
- Never start a competing model or a production rewrite.
- No growth, finances, rail, traffic simulation or save writes.
- Scope expands only after #55 accepts the thin tool.

## Isolation and launch
- **Imports:** `model.ts` imports nothing. `main.tsx` imports only `react`, `react-dom/client` and files in this directory.
  - Local helper modules are fine; third-party packages are not, because adding one rewrites the hash-pinned lockfile.
  - Never import `src/{simulation,shared,scenarios,persistence,rendering,app}`, Pixi, Three or IndexedDB.
  - `map-camera.ts` and the legacy `road-network.ts` were assessed and rejected (ADR 0005/0007).
- **"Construction" elsewhere in `src/`** means legacy building development (`pendingConstruction`) or the Millford road-build tool (`constructionMessage`, `constructionPreview`). Neither is this code.
- **Launch:** `npm run dev:construction`, then open **http://127.0.0.1:5178/construction.html** (`/` is the Millford app).
  - `--strictPort` fails if 5178 is busy; never test against an unknown server.
  - The "equivalent" `npm run dev -- --host 127.0.0.1 --port 5178` given in `construction-controls.md` lacks `--strictPort`.
  - Keep `construction.html` in the `vite.config.ts` build inputs.
- **Reset:** reload is the only reset today.
  - For #54, a visible "Reset site" control that reloads the page or swaps in a fresh `new ConstructionModel()` is allowed. It is not a state setter.
  - Never add a loader that installs a preset or target layout, because #55 must start empty and use ordinary controls.
- **No persistence:** never persist lab state. That would break the reload reset and the empty start, and new-model saves belong to M5 #38. The lab shares its origin with the Millford app, so any IndexedDB write risks the legacy slot.

## Model contract (`model.ts` is the sole authority)
- **API:** `snapshot()`, `preview(cmd)`, `execute(cmd)` (preview, then push the prior Snapshot) and `undo()`. There is no public state setter or legacy loader (ADR 0006), and no redo.
- **Commands:** `draw`, `connect`, `reshape`, `remove`, `section`, `remove-section`, `assign`.
- **State:** `Authored {nextId, roads, overrides}`.
  - `derive()` is pure and deterministic; it rebuilds geometry, `lanePaths`, `candidates` and `movements` from authored state.
  - Never store derived data in authored state, or authoritative state in React. Snapshots and results are deep-frozen.
- **Atomicity:** a failed preview or execute leaves snapshot identity, `nextId` and history unchanged.
  - Preview IDs are speculative, and a rejection reason may cite an uncommitted ID.
  - Commit with `execute(sameCommand)`, never by installing a preview snapshot.
- **Rejections:** reject user errors with `reject(code, message, ...roadIds)` inside `apply`/`derive`, never a plain `Error`, which escapes `preview` and crashes the editor.
  - The exported `snapPoint` does throw `Invalid` (`coordinate`/`bounds`), so UI callers must try/catch it, as `main.tsx` does.
  - A result carries exactly **one** reason, the first failure in this order:
    1. apply checks (capacity, lanes, snap/angle, section and assign preconditions);
    2. per-road checks in authored order: connection endpoint refs (`approach`), then length, curve-direction, curvature, slope, bounds;
    3. pairwise i<j checks: join-direction, then clearance;
    4. override revalidation.
  - Messages suggest a fix and never claim engineering impossibility; the bounds are conservative.
- **Reason codes:** stable kebab-case.
  - Tests pin only the #51 geometry codes. The section, assign and `missing-*` codes are asserted only as `ok: false`, so a rename breaks nothing.
  - Keep codes stable, and assert the code in any new rejection test.
- **IDs:** one allocator issues `authored-N` from 1.
  - `draw`/`connect` allocate the road, then forward lanes, then backward lanes. `section` allocates added lanes, then the section. A movement ID is `${from}>${to}`.
  - `reshape`, `section` and `assign` keep existing IDs. IDs are session identities, not persistence IDs.
- **Undo:** pops the exact prior Snapshot, **including `nextId`**, so later edits reuse IDs. Revalidate selections after undo (`finish()`).
  - Undo's `affectedRoadIds` is every road in both states. `assign` reports `[]` only for its own preview and execute.
  - Every successful execute is an undo step, including no-ops such as `assign null` with no override.
- **Performance:** each preview runs O(roads² × samples²) pairwise clearance checks, and history holds full snapshots. Profile before raising `maxRoads`/`samples` or previewing on pointer move.

## Geometry
- **Limits:** model limits live in the exported `LIMITS`; read them and add no new literals.
  - Existing exceptions: transition sample counts 17 and 33, the smoothstep factor 1.5, EPS, and the chord/3 handle.
  - `reject` messages hardcode LIMIT values: ±2000 m, ±30 m, 0–4 lanes, 20–1000 m, 20 m, 10%, 5 m, 32 roads.
  - `main.tsx` duplicates:
    - the 10/100 m grid, including the header's "10 m grid" text;
    - lane options 0–4;
    - elevation presets 0/+6/+10/−6 m and the "+6 m" crossing hint;
    - 45°;
    - the "±2000 m site" message;
    - the "15 m per metre of lateral change" hint;
    - the guide metres.
  - Labels read `centerline[32]`, which is valid only while `samples = 64`.
  - If a LIMIT changes, update all of these copies.
- **Snapping:** metres, math Y-up, Z = elevation. `Math.round` snaps XY to 10 m and Z to 1 m, with ties toward +∞ (15 → 20, −15 → −10).
  - Inputs in [−5, 0) XY or [−0.5, 0) Z snap to `-0`, which `toEqual` distinguishes from `0`.
- **Orientation:** SVG y = −model y (`pts`, `point`). Forward lanes run right of start→end, backward lanes left. The divider is the reference line; never recenter asymmetric roads.
- **Straights:** axis-aligned or exactly 45° after snapping; the model never rotates them. Length is the XY-only chord.
- **Connections:** one cubic Bezier between endpoints of two different *straight* roads, stored as `Endpoint` refs with chord/3 handles along the tangents.
  - A connection cannot be an approach, and cannot be reshaped or sectioned.
  - Removing or reshaping an approach removes or refits its connections.
- **Curve checks:** conservative hull bounds; curvature ≤ 1/(20 m + the wider side's width), grade ≤ 10%.
  - The default 2+1 quarter turn rejects a 120 m gap and passes **130 m** (pinned by tests).
  - For editing room, use a ~400 m gap, and a ~500 m approach with a 30–60% plateau when an inner alternative must appear.
- **No at-grade junctions:**
  - Coincident endpoints need exactly opposite tangents and equal grade (`join-direction`).
  - Wherever two roads' conservative envelopes (wider side width plus chord-error pad) come close, whether at crossings, overlaps or near-parallel roads, they need ≥5 m + pads of vertical separation (`clearance`).
  - Projected or elevated crossings never connect.
  - Grid snapping does not imply tile-based vehicle movement.

## Lanes, sections, overrides
- **Default links:** equal lane indices at coincident ends (2-point paths). No lateral jumps, U-turns or crossing links.
- **`section`:** straight roads only, widen-only.
  - `lanes` are **total** plateau counts ≥ base, never increments. Lanes can be added only in directions that already have lanes.
  - Taper at each end = 35 m (10 × 3.5 m) × the larger per-side added count, measured on the XY chord.
  - Full extents `[taperStart, taperEnd]` must fit in [0,1]. Otherwise the section rejects with `taper-space`, which also covers start ≥ end and non-finite t.
  - Extents may touch another section's extents but never overlap them (`section-overlap`). Neighbouring plateaus need both tapers between them.
  - Rendered edges sum section lanes, but width and envelopes use the widest section. Relaxing the overlap rule breaks clearance conservativeness.
  - A section widens the clearance envelope along the *whole* road, so it can reject on `clearance` because of a distant road. Never widen the whole road as a fallback.
  - Sections store normalized `t`. `reshape` keeps those intervals and IDs, and rejects `taper-space` if the shortened road lacks taper room.
- **Lane paths:**
  - Added lanes merge to the outer base lane by default (17-point linear).
  - Inner alternatives appear only in `candidates` (smoothstep, 33 points, span ≥15 m per metre of lateral shift).
  - Both parameter pairs are road parameters (0 = road start, 1 = road end).
    - `LanePath.startT/endT` are the first and last points in travel order, so backward lanes have startT > endT.
    - `Movement.fromT/toT` are the attachment parameters on the lanes' roads. Within one road they also follow travel order, so backward merges and alternatives have fromT > toT (e.g. 0.6 → 0.23 in `sections.test.ts`).
  - Attachments can be mid-road, so consumers must split base lanes at those points.
- **`assign`:**
  - `null` restores defaults, `[]` closes the lane, and a list is the exact deduplicated target set. Each target must be a candidate; otherwise the assign itself rejects with `assignment-invalidated`.
  - Any override pins its targets. An edit that would invalidate one rejects with `assignment-invalidated`, with lane IDs only in the message and `roadIds: []`. Never remap silently.
  - The UI's first checkbox toggle turns the defaults into an explicit override.
- **#55 scope risk:** alternative targets exist only *inside one straight road*.
  - Across roads, `assign` can only keep or close the equal-index default. There is no junction or turn-pocket routing, and no widening up to a road end.
  - Turn pockets, merges and roundabouts are M5 #31 criteria. Recommend keeping M4 thin and amending #55 with a dated section that scopes "assign its lanes".
  - Build more only on an explicit owner scope change, recorded first as a dated #53/#55 amendment plus an ADR 0006 finding.

## Editor (`main.tsx`)
- A single module-level `ConstructionModel`; React holds view state and the last snapshot. Every edit is a Command, and the view renders `preview.ok ? preview.snapshot : snapshot`.
- Lane checkboxes and Restore defaults execute immediately, without a preview.
- **Keyboard:** `Ctrl/Cmd+Z` lives on `<main>` keydown, so it works only while focus is inside `<main>`, and only for lowercase `z`. It is skipped while focus is in an INPUT or SELECT (checkboxes included). Escape is not gated.
- **Known gaps (document them, don't hide them):**
  - Placement, sections and pan need a pointer.
  - No screen-reader map.
  - Touch and trackpad are unverified.
  - Elevation is shown only by fill colour and a label of the *start* z.
- **#54 inspection aid:** a read-only derived-state export behind a visible control (e.g. "Copy derived state") may support inspection. Never expose the model on `window` or read it from page scripts: the evidence bar excludes page model access. The export is never interaction evidence.
- **#54 brief:**
  - an empty, resettable launcher;
  - a human-readable target layout (see `construction-controls.md` "Checks and downstream acceptance");
  - predeclared success criteria and a confusion/retry checklist;
  - provenance;
  - the evidence #55 must retain;
  - accessibility gaps.

  No participant gate. Preparation is not acceptance.
- **Style:** sources are Prettier 3.9.6 default-clean with no config. Format only the files you change (`npx prettier@3.9.6 --no-config --write <files>`), and never add Prettier to `package.json`.

## Tests (`npx vitest run src/experimental/construction`)
- Co-located `*.test.ts`, run in Vitest's default node env with no header. Never import `main.tsx`: it renders at load. The UI has no automated tests.
- **Pinned outputs:** tests pin only the 17-point taper and 33-point alternative paths. Nothing pins the 65-point centerlines.
- **Idioms:**
  - The `success()`/`ok()` helpers throw with the reasons.
  - Atomicity: `expect(m.snapshot()).toBe(before)` plus an unchanged `nextId`.
  - Undo: `toBe` for one step, `toEqual` over a reversed history.
  - Codes: `toMatchObject`.
- **Each new command needs tests for:**
  - preview without mutation;
  - preview equal to execute;
  - atomic coded rejection;
  - unrelated IDs and geometry unchanged;
  - exact undo.
- **Evidence:** agent or browser runs are not the #55 walkthrough. Never tick #54/#55 or claim acceptance.
