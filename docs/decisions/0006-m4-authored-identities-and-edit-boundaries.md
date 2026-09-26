# 0006 — Own construction identities and edits in the model

- Status: Proposed
- Date: 2026-09-07
- Scope: M4 construction commands, snapshots and downstream section-edit design
- Tracking: [#51](https://github.com/Kminkjan/infrastructurio/issues/51), #52/#53
- Evidence: [API handoff](../research/m4/construction.md)
- Decision authority: Pending scoped PR review
- Supersedes: None
- Superseded by: None

## Context

Controls, lane editing and eventual rendering must share one authority. Stable
selection cannot depend on sample indices or geometry-derived identifiers. The first
workflow ends in undo and must restore exact authored state after rejected previews.

## Decision

A model owns immutable authored roads and lane identities. A single deterministic
allocator supplies road and lane IDs, separately from derived arrays. A connection
stores endpoint references, not copied approach positions. Lane paths and legal
movements are rebuilt deterministically. Defaults connect spatially continuous,
matching lane ranks at compatible endpoints; extra lanes terminate without an
implicit lateral jump. Movement IDs are derived from the two authored lane IDs.

`preview` validates the entire candidate without consuming IDs or undo history.
`execute` uses that same path and commits only valid candidates. `undo` restores the
previous immutable snapshot including allocator. Branching after undo may reuse IDs
from discarded history: UI selection must be refreshed after undo. This is an
in-memory session identity contract, not globally unique persistence IDs.

Removal explicitly reports the removed road and its dependent connectors. Reshape
preserves all road/lane IDs and reports refitted dependents. There is no silent
remapping to another endpoint. No public arbitrary-state setter or legacy loader
is provided. Failed commands return a stable code, actionable text and implicated
road IDs where known; the first failure is reported deterministically.

For #53, propose authored road-local section intervals in normalized curve parameter
`t` with stable section IDs and explicitly authored lane IDs. Store a plateau and
its transition intervals separately. Measure transition space along derived arc
length, not as a fixed parameter delta. Keep the road's divider and unaffected
lane IDs fixed; add new IDs only for new lanes. Start with a minimum taper length
of ten times the lateral width change as an experimental candidate, to be validated
in #53, not a rule implemented or accepted here. Reject overlap or insufficient
space atomically; do not widen an entire approach as a fallback.

Explicit lane connections should be authored overrides keyed by stable incoming
lane ID and an explicit list of outgoing lane IDs (including an empty list).
Derive and validate their paths separately from defaults. Preserve valid overrides
through unrelated edits; reject edits that invalidate an override with named lane
IDs until the UI offers an explicit removal action. Never silently remap a target.
Extend the same preview/execute transaction and snapshot undo mechanism for those
commands; this PR does not implement section editing or lane-override controls.

## Alternatives considered

- Geometry-index lane IDs change under resampling and cannot preserve selections.
- Renderer-owned mutations duplicate authority and bypass atomic validation.
- Incremental inverse commands save memory but introduce dependency/allocator
  restoration complexity. Immutable full-snapshot history is adequate for the
  small proof; production memory budgeting remains open.
- Storing road sections as separate roads would accidentally change road identity
  and endpoint topology during local widening. Road-local authored sections keep
  that distinction explicit.
- Always regenerating automatic connections would erase user intent; authored
  overrides must be separate from generated defaults.

Legacy command/snapshot separation and atomic test patterns fit (ADR 0002). Legacy
RoadSegment IDs alone do not supply lane identities, and aggregate RoadLinks cannot
represent lane permissions. Legacy simulation/scenario/persistence imports are
excluded. Existing IndexedDB namespaces are unsafe for this separate experiment,
as documented in the M4 inventory; nothing here reads or writes them.

## Consequences

#52 can implement controls against the model immediately. #53 should extend the
small module when implementing transitions and overrides, with tests proving
unrelated-state preservation; the proposed section schema is guidance rather than
an unused public API. Snapshots carry no dynamics, finance or persistence version.
History has no production memory bound, redo, collaboration or save contract.

## Validation and acceptance boundaries

Tests verify previews, rejected edits, dependent removal, stable IDs and exact undo.
Local transitions and authored lane overrides remain #53 acceptance work. The full
sequence and human observations remain #55; proposed ADRs do not close any gate.

## Revisit when

Section editing reveals unsuitable identity boundaries, undo consumes material
memory, or production persistence/traffic introduces stronger lifecycle requirements.

## History

- 2026-09-07: Proposed for #51 with explicit #53 extension guidance.

## #52/#53 implementation findings — 2026-09-07 (still Proposed)

The earlier #53 guidance above is now implemented for **straight approaches only**.
`section` authors a normalized plateau plus explicit entry/exit taper boundaries;
`remove-section` restores the original local width. Curved local widening, narrowing
below base counts and creation of a direction absent from the base road reject.
Each added lane and section receives a stable ID; existing lane IDs and divider
remain fixed. Multiple nonoverlapping plateaux/tapers remain independent. Counts
are total plateau counts, not increments. Bounds include 10 m longitudinal taper
per metre of maximum added width on either side (35 m for one extra lane).
Reshape rejects if the stored normalized intervals would leave shorter tapers.

Road edges are derived at sample stations from local section weights. Maximum
width uses the widest section, not a sum of disjoint section lanes. Clearance still
uses conservative whole-road maximum side envelopes: an edit may reject because
of a nearby road outside the plateau, rather than proving exact swept-edge contact.
That conservative limitation is visible through model rejection; the UI never
widens the entire road as a fallback.

`assign` authors an incoming lane's exact outgoing target list; `null` restores
defaults, while `[]` explicitly closes its outgoing permissions. Snapshot candidates
are separate from legal movements and authored overrides. Default local movements
connect each added lane to the outer continuing lane through its taper. Movements
carry `fromT`/`toT` road parameters and full transition paths; lane paths carry
`startT`/`endT` so interior graph attachments are unambiguous. A consumer must split
continuing lane traversal at attachment positions, not treat these as endpoint-only
edges. No traffic graph consumer is introduced here.

An added lane may instead target an inner continuing lane over its plateau plus
exit taper. Its smoothstep lateral path has aligned endpoint tangents; the analytic
maximum lateral slope is 1.5 times lateral displacement divided by available plan
length. Require at most 0.1, equivalently 15 m span per metre of lateral change.
This constraint also bounds curvature below the experiment's 20 m radius threshold
for the supported lane-width changes. Reverse-direction paths have decreasing road
parameters. Insufficient space removes that candidate and explicit assignment to it
rejects atomically. Arbitrary cross-road lateral jumps at zero-length throats remain
unsupported; only continuous cross-road defaults are candidates.

Every edit revalidates explicit targets. Invalidated assignments reject with lane
IDs; there is no silent remap. Undo restores the entire prior frozen snapshot and
allocator, including overrides, candidates, attachment parameters and paths.
Behavioral tests cover positive local widening, independent sections, space/overlap
rejection, preserved unrelated state, alternative assignment, reverse travel,
invalidated overrides and complete reverse undo. See
[construction controls evidence](../research/m4/construction-controls.md).
These findings update the experiment proposal, not production #31 or #55 acceptance.
