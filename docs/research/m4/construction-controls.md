# M4 construction controls and local lane editing — #52/#53

## Recovery and fresh verification — 2026-09-26

The temporary clone described below disappeared before commit `51944d1` was pushed.
Reviewed source-writing commands from the retained implementation session were
replayed in the durable isolated worktree
`/Users/krisminkjan/.codex/worktrees/8192/infrastructurio`, from `f4a050f`, including
the original cached Prettier 3.9.6 formatting steps. No historic Git mutations,
tests or servers were replayed. Recovery commit `2234736` matches the recorded
13-file, 1963-insertion, 18-deletion statistics. The original Git object is gone,
so full original tree identity cannot independently be proved. No known source
edit was missing from the retained sequence.

Main `fc90d75` was integrated in `6ea5c02`. The only conflict was package scripts;
both `dev:construction` and main's `research:m4:human` were retained. The recovery
PR targets main. No protected gameplay working-tree content was imported or modified.

Fresh checks on recovered integrated source, Darwin arm64 and Node v26.7.0:
`npm test` **95/95**, `npm run test:m4` **25/25**, `npm run typecheck`,
`npm run build`, and `git diff --check` pass. The construction bundle filename
`construction-CuuPxbN8.js` matches the recorded final September 7 build; this supports
recovery but does not replace fresh checks. A fresh `npm run dev:construction` and
ordinary in-app browser load displayed the controls, guidance and empty site
(0 roads / 0 legal connections). The complete September 7 browser sequence below
was not rerun on September 26. Historic observations remain historic, and no new
human walkthrough, #54/#55 completion or production acceptance is claimed.

## Original implementation record — 2026-09-07

This combined experiment starts at exact geometry baseline
`f4a050fd5bcbb21d0d6a195ca44bdeabb6f8a36e`, on branch
`codex/m4-construction-controls-lanes`, with draft PR base
`codex/m4-construction-geometry` (geometry draft PR #57). It does not import PR #49.
Implementation and checks ran only in the independent clone
`/private/tmp/m4-controls-lanes`. The initially supplied worktree shared Git metadata
with the protected gameplay checkout; branch creation was denied before mutation,
so an independent `--no-hardlinks` clone was used instead. The original gameplay
checkout was neither modified nor tested.

## Run the development entry point

Use Node >=20.19 in this branch's isolated checkout:

```sh
npm ci
npm run dev:construction
```

Open **http://127.0.0.1:5178/construction.html**. The site starts empty. Browser
reload resets only this in-memory experiment; it never reads or writes legacy saves.
`npm run build` emits both the existing gameplay document and a separate
`dist/construction.html`. The gameplay entry imports no construction module.
`npm run dev -- --host 127.0.0.1 --port 5178` is the equivalent generic Vite command.

This is the minimal development entry, not #54's packaged launcher or final review
protocol. #54 can add its resettable reference/target presentation around this page
and API without reimplementing the editor or importing a legacy scenario.

## Ordinary controls

1. **Draw road**: choose a preset or independent forward/backward counts, then click
   start and end on the visible grid. A dashed guide snaps to 45° increments. Click
   **Commit preview** when valid. Counts follow the road's start → end orientation.
2. Draw a second approach above and right of the first, facing north. The initial
   view is 1200 m wide, with 10 m grid lines and stronger 100 m lines. Leave ample
   space between approaches: default 2+1 equal-axis quarter turns pass at 130 m,
   reject at 120 m, while 400 m is a spacious editing example.
3. **Connect endpoints**: click the first approach's end and the second approach's
   start handles. The fitted curve and lane paths preview before commit. Wrong
   orientation, tight curvature, overlap or slope produces model feedback and a
   disabled commit. Cancel or Escape discards the pending edit.
4. **Widen section**: choose total plateau counts (e.g. 3 forward, 1 backward), then
   click two places on a straight road. The selected plateau and explicit entry/exit
   tapers preview. Leave 35 m on both sides for one extra lane; twice that for two.
   Yellow marks bound the plateau and pink marks bound its tapers. Unrelated parts
   retain their original widths. Existing sections can be removed from Selection.
5. **Incoming lane**: choose the added forward lane. Targets are named by road,
   direction and lane rank. Check an inner target, then uncheck the default outer
   target to change its assignment. Each checkbox change is one authored edit and
   one undo step. Selected incoming paths are yellow; legal outgoing paths are pink.
   Inner targets need sufficient plateau/exit span and otherwise are unavailable.
   Restore defaults explicitly removes the authored override.
6. **Undo** reverses each committed edit, including assignments. It cancels stale
   previews and refreshes selections. Undo back through assignments, widening,
   curve and both roads returns to the empty model. Cancel adds no undo step.

Select a road body or endpoint for stable selection. **Reshape** selects a straight
road endpoint, then a new snapped position; connections refit atomically. **Preview
delete** names how many roads are affected before commit. A road removal also removes
its dependent connectors, but rejects if it invalidates explicit lane targets.
Choose **Pan** and drag, use middle-button drag, or use zoom buttons/wheel. Reset view
restores the overview without modifying construction. Construction elevation presets
include ground, +6, +10 and −6 m. Drawing a +6 m road across a ground road provides a
crossing with no accidental lane connection. The model has broader elevation bounds;
this UI deliberately offers a small set of useful heights.

## API additions to #51

The same `snapshot / preview / execute / undo` transaction owns all edits. Read
[the original geometry handoff](construction.md) for the base contract.

| Addition | Meaning |
| --- | --- |
| `section { roadId, start, end, lanes }` | Add a straight-road plateau in normalized road parameter, with total lane counts and automatically reserved taper intervals. |
| `remove-section { roadId, sectionId }` | Remove one authored local widening. Reject if it invalidates an explicit assignment. |
| `assign { fromLaneId, toLaneIds }` | Exact authored outgoing target list; `[]` closes outgoing permissions, `null` restores defaults. |
| `Road.sections` | Stable section IDs, plateau/taper intervals and separately allocated added lanes. Base lanes retain IDs. |
| `Authored.overrides` | Explicit permissions independent of generated defaults. |
| `Geometry.edges` | Local derived left/right surface edges; maximum side widths remain conservative clearance bounds. |
| `LanePath.startT / endT` | Road parameters of first/last sampled point in lane travel order. |
| `Movement.fromT / toT` | Road attachment parameters for the source/target lanes, including interior attachments. |
| `Snapshot.candidates` | Valid selectable movement paths, separate from legal `movements` and authored overrides. |

A future graph consumer must split base-lane traversal at interior movement
attachments; it must not assume all movements join whole-road endpoints. Local
added lanes default to the outer continuing lane through explicit taper spans.
An added lane can alternatively target an inner continuing lane over the plateau
plus exit taper with a smoothstep offset. The analytic maximum lateral slope must
be <=0.1, requiring span >=15 times lateral displacement. It has aligned endpoint
tangents and stays within the widened straight-road envelope. Cross-road candidates
remain only spatially continuous lane-end defaults. Arbitrary lateral throat jumps,
U-turns and intersection lane routing are not supplied by this bounded proof.

Plateaux cannot overlap including their tapers. Narrowing below base counts,
widening curves or creating a direction absent from the base road reject explicitly.
Reshape retains normalized intervals and IDs; it rejects shortened taper space and
revalidates assignments. All failures leave authored state, allocator, geometry,
candidates, legal movements and undo history untouched. Explicit targets that lose
validity reject with lane IDs rather than silently changing their meaning.

## Automated browser observations — 2026-09-07

Environment: Darwin arm64, Node v26.7.0, Codex in-app Chromium browser at its ordinary
desktop viewport (screenshots approximately 1406 × 791). This was an **agent-driven
browser check**, not an owner/human walkthrough or first-time-player study.
Actions used CUA pointer clicks/drag, named visible endpoint handles, native selects,
checkboxes, buttons and keyboard input. No state injection, page model access,
coordinate-entry fields or world-to-screen projection oracle was used.

Observed sequence from empty:

- Two visible-grid road placements committed, producing 2 roads / 0 legal movements.
- Selected named endpoint handles and committed a valid automatic curve: 3 roads /
  6 legal movements. Earlier tiny pointer handle misses motivated larger fixed-pixel
  hit areas; named endpoint activation supplied reliable ordinary DOM interaction.
- Marked a middle plateau (displayed 30–75%) and widened 2+1 to 3+1: 3 roads / 8
  legal movements; visible plateau and taper markers, original ends unchanged.
- Selected forward lane 3. Added forward lane 1 as target (9 legal movements), then
  removed default forward lane 2 (8). A smooth pink path showed the alternative.
- Tried removing the section with that assignment: rejected and named
  `authored-13 → authored-2`; no commit became available.
- Cancelled, then undid each edit separately: restored both targets (9), default
  target (8), original width (6), removed curve (2 roads / 0), removed second road
  (1 / 0), then empty (0 / 0). Model tests separately verify exact immutable state.

Additional ordinary-control checks:

- Ground crossing rejected with clearance guidance and disabled commit; Escape
  cancelled it. Repeated at +6 m and committed: 2 roads / 0 connections.
- Pan drag and Zoom in visibly changed the view; Reset view restored it.
- A tight endpoint connection rejected with curvature/space guidance.
- Reshape endpoint → new position → valid preview → commit worked. Preview delete
  and commit removed that selected approach; Undo restored it and safely cleared
  stale selection.
- A section boundary too near the road end rejected with “Leave 35 m of taper space
  before and after the selected plateau.”
- After adding endpoint button semantics, Enter activated an endpoint for reshape.
  Escape cancellation was exercised. Ctrl/Cmd+Z is implemented but this automated
  run used the Undo button; physical keyboard/platform shortcuts remain #55 checks.

Actual friction/limitations: the sidebar scrolls at this viewport and lower lane
controls require scrolling; toolbar remains above the map. Small road/endpoint
features benefit from zoom. Endpoint hit areas were enlarged and disabled as
interceptors outside select/connect/reshape so section clicks reach road bodies.
The SVG map is not a complete accessible spatial editor: native controls and endpoint
buttons are keyboard operable, but placement, section selection and pan still need
a pointer. Touch, mobile layout, screen readers, wheel hardware and physical mouse
versus trackpad behavior were not validated. Elevation is label/color based in plan
view, with no terrain/deck structure or 3D occlusion. No timing/performance claim.

## Checks and downstream acceptance

Recorded on the implementation source on 2026-09-07:

```sh
npm test                 # 95 tests, 16 files (22 construction tests)
npm run test:m4          # 15 research checks
npm run typecheck
npm run build            # includes construction.html
git diff --check
```

All pass. Section tests cover exact undo, invalid edits, independent sections,
preserved explicit targets, invalidation rejection, a different outgoing target with
bounded smooth geometry, insufficient assignment span and reverse travel attachments.
Existing #51 geometry tests retain the 120/130 m curve threshold and XYZ crossing
clearance regression. There are no production persistence, traffic or finances tests
for this experiment because those systems are not connected.

[ADR 0006](../../decisions/0006-m4-authored-identities-and-edit-boundaries.md) records
actual section/assignment findings and remains **Proposed**.
[ADR 0007](../../decisions/0007-m4-construction-plan-editor.md) proposes only this
experimental presentation, including the camera/render/input reuse assessment.

#54 should provide the final target layout, reset/launcher packaging, revision-pinned
protocol and evidence checklist, including the sidebar/keyboard/elevation limitations
above. Keep a sufficiently long first approach and plateau for the alternative target
(e.g. 500 m approach, plateau 30–60%; 35 m tapers) rather than an automation-only fixture.
Its review must still use normal controls. #55 must execute an actual owner/human
walkthrough and publish its acceptance disposition. #26/#28 production decisions,
#21/M4 broader gates and M5 remain open; the old paired human exercise is deferred,
not passed. No merge, issue closure or milestone closure is implied here.
