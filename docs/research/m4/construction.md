# M4 construction geometry — #51 API handoff

**Follow-up:** [#52/#53 controls, sections and lane assignments](construction-controls.md)
implements the extension below. This document retains the original #51 handoff
and validation record; current API additions and browser evidence are in that follow-up.

This isolated proof starts at `f6b3de13acb4349d8ffcc4aac60594e174f3a3ae`
on `codex/m4-orchestration` (main `f18878b` plus owner documentation). Implementation
branch: `codex/m4-construction-geometry`. No PR #49 research tooling was imported.

The authoritative entry point is
[`src/experimental/construction/model.ts`](../../../src/experimental/construction/model.ts).
It has no application, renderer, scenario, persistence or traffic imports. The
production entry point does not import it; TypeScript and Vitest still check it.
[ADR 0005](../../decisions/0005-m4-grid-and-automatic-curves.md) and
[ADR 0006](../../decisions/0006-m4-authored-identities-and-edit-boundaries.md) are
**Proposed** and describe experimental choices and alternatives.

## Commands and snapshots

```ts
const model = new ConstructionModel();
const a = model.execute({ type: 'draw',
  start: { x: -200, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 },
  lanes: { forward: 2, backward: 1 } });
// Check a.ok; a.affectedRoadIds[0] is the new authored road ID.
const b = model.execute({ type: 'draw',
  start: { x: 400, y: 400, z: 0 }, end: { x: 400, y: 600, z: 0 },
  lanes: { forward: 2, backward: 1 } });
if (a.ok && b.ok) {
  const command = { type: 'connect' as const,
    from: { roadId: a.affectedRoadIds[0], end: 'end' as const },
    to: { roadId: b.affectedRoadIds[0], end: 'start' as const },
    lanes: { forward: 2, backward: 1 } };
  const preview = model.preview(command); // no mutation or ID consumption
  if (preview.ok) model.execute(command);
}
model.undo(); // restores both authored and derived state, including allocator
```

`draw`, `connect`, `reshape`, `remove` are the command union. `reshape` takes a
straight road ID and replacement start/end points; dependent connections refit.
Removing an approach also removes its dependent connectors. Both operations report
all affected road IDs so controls can explain the consequences in a preview.
`undo` is a model method, not a geometry command. Cancel simply discards a preview.

Successful results contain an immutable `snapshot` and `affectedRoadIds`. Failures
contain `reasons` with code/message/roadIds and change neither snapshot, allocator
nor history. Preview IDs are speculative until commit. Call execute with the command
when committing; do not install a stale preview. Snapshots are deeply frozen:

| Field | Ownership and consumption |
| --- | --- |
| `authored.roads` | Stable road/lane IDs, straight endpoints or connection endpoint references; selection uses these IDs. |
| `authored.nextId` | Model allocator, restored by undo; discarded-history IDs may be reused. |
| `geometry` | Cubic controls, 65 centerline points, full width and separate left/right widths; render as derived data. |
| `lanePaths` | 65 points ordered in lane travel direction, keyed by authored lane ID. |
| `movements` | Matching lane-rank defaults at spatially continuous endpoints; IDs derive from source/target lane IDs. |

Movement paths currently contain two coincident endpoint points: they are legal
continuity edges, not traversable junction curves. The connector road's lane path
provides the actual curved travel. No default lane jump, U-turn, crossing connection
or movement exists merely because roads overlap on screen. Extra unmatched lanes
terminate. Direction counts refer to each road's own start → end orientation;
reversing an approach may require swapping counts to preserve continuous lanes.

## Practical geometry bounds

Read exported `LIMITS` for model-owned values; do not duplicate them in controls.
`Point` means metres with XY plan and Z elevation. Grid ties round toward positive
infinity. Straight road orientation is restricted to multiples of 45°. Invalid
angles reject rather than silently rotate the road. Z snapping is independent.

The tested 90° example uses a 400×400 m gap. For equal X/Y gap D, horizontal
approaches and 2 forward/1 backward lanes, the conservative curvature bound is
`4.485281374 / D`; its width-adjusted radius requirement is 27 m. Thus curvature
alone requires D ≥121.103 m, or **130 m on the 10 m grid**. Tests bracket 120 m
(rejected) and 130 m (accepted). Other angles, lane counts, slopes or nearby roads
change validity; always preview. The 400 m fixture deliberately leaves editing room.

Validation uses continuous derivative bounds rather than only sampled curvature.
Clearance uses sampled swept envelopes padded by a continuous XYZ chord-error
bound. A graded, plan-straight connector can bow vertically: tests cover a 5 m
midpoint bow from ±5% approach grades, rejecting a crossing that only meets the
height limit at its centre but violates it across road width. A crossing 1 m lower
passes. This is a bounded surface clearance experiment, not a structural bridge,
terrain or production civil-design model. Conservative envelopes can reject usable
layouts, especially one-way roads; no real-world design compliance is claimed.

## Downstream sequence and extension boundary

#52 should use only commands and immutable snapshots for drawing, previews, snapping,
reshape, deletion and undo. Use `snapPoint` for grid feedback; catch its validation
error for non-finite/out-of-bounds input, or use preview for structured reasons.
Refresh selections after commits/undo and show dependent deletions before commit.
No renderer preference is imposed by this module.

#53 adds section interval commands, transition geometry and authored movement
overrides to this model; see ADR 0006 for concrete identity and validation guidance.
Do not split one widened road into unrelated authored roads or derive lane IDs from
sample indices. Keep IDs for unaffected lanes, add IDs for new lanes, preserve valid
explicit targets, and reject invalidated targets with reasons. Use the same atomic
preview path and snapshot history so section/lane undo is exact. The current model
has uniform sections only; no claim is made that the full five-step sequence works.

#54 packages ordinary controls and a resettable reference site. #55 must execute
**draw two roads → curved connection → widen approach → assign lanes → undo** and
record an actual human walkthrough. Automated model checks do not satisfy that gate.
The old paired human exercise remains deferred. #26/#28 production decisions and
M5 #29–#31 integration remain open. No growth, finances, rail, traffic, persistence,
legacy-save writes or production rewrite are included.

## Verification

Run from this isolated checkout with Node >=20.19:

```sh
npm test -- src/experimental/construction/model.test.ts
npm test
npm run test:m4
npm run typecheck
npm run build
```

Behavioral coverage includes snapped and curved joins, independent direction counts,
reverse-oriented approaches, exact undo, failed edit restoration, dependent removal,
invalid curvature/width/slope/elevation, continuous curvature checks, asymmetric road
footprints and grade-separated crossings. See the committed test source for fixtures.
The implementation has no browser interaction or measured performance claim; pairwise
clearance and full-snapshot history are bounded experiment choices requiring profiling
before any expansion. Original gameplay checkout was not mutated or tested.

Recorded 2026-09-07 on Darwin arm64, Node v26.7.0: all **86 Vitest tests**
(including 13 construction tests), **15 M4 research checks**, `typecheck`, `build`
and `git diff --check` pass. No human session or fresh browser timing run was
performed for #51. Changes are confined to this model, its tests and documentation.
