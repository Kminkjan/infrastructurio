# M4 construction orchestration ledger

Updated 2026-09-26. GitHub issue bodies remain authoritative.

## September 26 consolidation

The owner explicitly authorized putting existing work on main and writing a handoff.
PRs #49, #56 and #57 are now merged (`fc90d75` after these merges). This supersedes
the earlier no-merge instruction for this consolidation only; it does not authorize
milestone closure or claim human acceptance. See [the current handoff and continuation
script](../../M4-HANDOFF.md) for current status and restart instructions.

The #52/#53 task stopped on September 7 due to an account usage limit before publication.
Its temporary clone no longer existed on September 26. Source was recovered into the
durable isolated worktree `8192` and freshly checked before consolidation. PR #58 now consolidates the recovered implementation onto main. Historical
browser observations remain distinct from recovery checks. The table below records
the original dispatch history; consult the handoff for final PR disposition.

## Baseline and documentation handoff

Fetched origin/main at `f18878bd8b817132a0eb00409099542f8cb71cfd`.
Orchestration branch: `codex/m4-orchestration`, isolated worktree `380b`.
Dedicated documentation commit `f6b3de1` applies only the intended uncommitted
changes from source worktree `56ab`: CONTRIBUTING, README, ROADMAP, prototype
plan/backlog, ADR index/template. Applied the five tracked-file diffs after checking
against main; copied the two new ADR workflow files. Existing ADRs are unchanged.
PR #49 (`e36ea6a`, `codex/m4-human-comparison`) remains separate research tooling.

## Execution and review gates

| Work | Task | Baseline / branch | State / next action |
| --- | --- | --- | --- |
| Documentation and coordination | This task | `f18878b` → `codex/m4-orchestration` | Draft PR #56; docs committed; maintain ledger and review dependent commits. |
| #51 geometry/connection rules | `01a0780c-39b4-7bd0-93a8-b122fead58fa` (worktree `6d14`) | `f6b3de1` → requested `codex/m4-construction-geometry` | Reviewed `f4a050f`; draft PR #57 targets orchestration. Independent 13-test/typecheck rerun passes; XYZ clearance review concern fixed. |
| #52 controls and #53 sections/lanes | `01a07a79-6606-7833-9922-7781d8808d6b` (independent clone `/private/tmp/m4-controls-lanes`) | `f4a050f` → `codex/m4-construction-controls-lanes` | Dispatched jointly after #51 source/test review; draft PR to target geometry branch. |
| #54 reference site/protocol | Not dispatched | Reviewed #51–#53 required | Package ordinary-input sequence and predeclared review criteria. |
| #55 independent verification | Not dispatched | Reviewed #51–#54 required | Run browser and behavioral verification, resolve defects; leave human gate open until performed. |

Each implementation task uses its own worktree and a draft PR with explicit base.
No task may mutate another checkout. Review source and checks before dispatching
dependent work; retain separate issue criteria if #52/#53 are combined.

## Review checks before dependent dispatch

- #51: trace stable authored road/lane identities through regeneration and removal;
  inspect curve endpoint/tangent joins and bounded validation, including non-finite
  input, near-degenerate curves, wide offsets and elevation clearance. Verify
  rejected commands leave authored state and ID allocation unchanged.
- #52/#53: use visible controls without injected state; inspect previews versus
  commit, cancellation, selection after reshape/delete, local transition boundaries,
  and explicit lane assignments after widening. Compare every undo snapshot to its
  corresponding prior authored state and regenerated legal movement graph.
- #54/#55: reproduce from the named source revision, record the actual startup
  environment, browser interactions and negative cases, then separate automated
  results from the remaining participant observations. No coordinate-projection
  oracle may stand in for discovering and operating the visible controls.

## Controls/lane review in progress

Early review required explicit road-parameter attachment positions for local lane
merges, maximum rather than summed width across disjoint sections, and a meaningful
alternative outgoing lane with a bounded smooth path. The implementation task reports
addressing these and exercising the thin workflow in the in-app browser using visible
grid clicks, endpoint controls and lane target checkboxes. It reports a changed target,
assignment-invalidation rejection and reverse undo of targets and widening. These are
agent implementation observations, pending committed evidence and independent #55
verification; they are not participant evidence or issue acceptance.

## Acceptance boundaries

Required sequence: draw two roads → create one curved connection → widen one
approach → assign its lanes → undo each change to initial state. Also verify an
invalid curve/transition and an elevation-separated crossing with no connection.
Geometry, lane connectivity and undo defects block acceptance.

#55 requires an actual owner/human walkthrough; automated interaction does not
supply participant evidence. The old paired human exercise is deferred, not passed.
#27 is OPEN with PR #49's formal bounded-research closure recommendation awaiting
disposition; no closure assumed. #26 and #28 production decisions remain OPEN.
#50 informs them without depending on final #28 acceptance. #21 and milestone 5
remain OPEN. M5 #29–#31 retain production integration/hardening criteria.

No growth, finances, rail, full traffic, legacy saves or production rewrite belongs
in this proof. Commands and snapshots are model-owned and renderer-independent;
authored IDs, derived geometry and legal movement are separate. Grid-assisted
construction does not mandate tile-based vehicle movement.

## Preservation

Never mutate, switch/reset/clean/merge into, import uncommitted work from, or run
tests in `/Users/krisminkjan/Documents/CodexRepos/infrastructurio`. Preserve branch
`codex/issue-19-release-gate`, HEAD `18dc5ee`, and its ten modified gameplay files;
expected binary diff SHA-256 is
`42c4eec5ee1290dd8fbfd62cac7edccce0bf23b53579a12dff50c7877b993841`.
This rule is included in every implementation task dispatch.
