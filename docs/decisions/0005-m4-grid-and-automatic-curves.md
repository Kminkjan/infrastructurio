# 0005 — Bound grid-assisted approaches and automatic curves

- Status: Proposed
- Date: 2026-09-07
- Scope: M4 construction experiment only
- Tracking: [#51](https://github.com/Kminkjan/infrastructurio/issues/51), parent #50
- Evidence: [API and behavioral checks](../research/m4/construction.md)
- Decision authority: Pending scoped PR review
- Supersedes: None
- Superseded by: None

## Context

The thin construction workflow needs predictable snapped roads and a smooth fitted
connection, independent of renderer choice. The trailer is a UX reference; it gives
no evidence for our grid size, fitting algorithm or engineering constraints.

## Decision

Propose 10 m XY snapping (ties toward positive infinity), 1 m elevation snapping,
and straight approaches in 45° increments. The experimental site is ±2000 m XY,
±30 m Z, with endpoint separation 20–1000 m and at most 32 roads. Allow 0–4 lanes
independently in each direction, at least one overall, each 3.5 m wide. The authored
reference line is the directional divider: forward lanes lie to its right,
backward lanes to its left in mathematical XY. Asymmetric carriageways therefore
have asymmetric footprints; they are not recentered during regeneration.

Fit one cubic Bezier between selected straight-road endpoints, with handle lengths
one third of the endpoint chord. Handles follow the outward approach tangents,
including elevation slope. This gives positional and tangent continuity, not
curvature continuity. Connections reference approaches; reshaping an approach refits
its dependents atomically. Connections cannot themselves be approaches.

Require positive chordwise derivative throughout the curve. Use derivative control
vectors' convex hull bounds for curvature and grade, rejecting when the conservative
inner radius bound is below 20 m or grade exceeds 10%. This may reject a geometrically
feasible curve; feedback should suggest more space or fewer lanes, not imply an
engineering impossibility. There is no optimization search for a different fit.

Clearance uses 64 sampled segments per curve, swept conservative circular envelopes
around the divider, and a continuous Bezier chord-error padding. Asymmetric roads
use the larger side width for their envelope. Compare full segment elevation
intervals, with padding, requiring 5 m separation wherever envelopes overlap.
Shared smooth endpoints permit their joining envelopes to meet within one combined
radius. Other at-grade intersections/overlaps are rejected, not split into junctions.
Only aligned, same-height endpoints can produce legal movements; projected crossings
never do. The 5 m is an experimental surface-height rule, not a bridge design code;
terrain, deck thickness, supports, banking and earthworks are absent.

## Alternatives considered

- Unconstrained endpoints/manual cubic handles offer more freedom but require a
  larger control and validation surface than the first workflow establishes.
- Circular fillets give constant radius but restrict approach geometry; clothoids
  add curvature continuity and solver complexity without a demonstrated need here.
- Searching several handle lengths may recover rejected fits, but obscures the
  initial deterministic fitting contract. Revisit after observing rejected previews.
- Sample-only curvature checks are simpler but can miss a tight bend between samples.
  Conservative continuous derivative bounds explicitly trade usable space for safety.
- Exact swept road polygons and adaptive subdivision would reduce false clearance
  rejections. Fixed padded segments keep this small proof reviewable.

Legacy `src/simulation/transport/road-network.ts` splits every XY intersection and
assigns aggregate capacity to straight links. Its topology and units do not fit.
The old rendering experiment has useful visual curve examples, but hand-authored
control points and no authoritative validation; importing its mutable scene would
not supply this model. Reuse the deterministic command/testing approach of ADR 0002;
no legacy runtime code is imported. Camera/input utilities remain candidates for #52,
not dependencies of geometry.

## Consequences

The implementation is a small isolated module with no renderer choice, traffic,
persistence or production migration. Conservative clearance can reject roads whose
actual asymmetric edges do not touch. Curves needing loops, U-turns, interior splits,
nonaligned junction throats or chained connectors are outside this proof.

## Validation and acceptance boundaries

Behavioral checks cover snapped and curved joins, continuous numerical curvature
checks supplementing the analytic bound, invalid curves/grades, asymmetric widths,
elevated crossings and removal. These are model tests, not construction usability
or engineering certification. #55 still requires an actual human walkthrough;
#26/#28 and production #29 remain open. The old paired human exercise is deferred.

## Revisit when

The first UI workflow requires excessively large gaps, clearance rejects useful
layouts, or section widening needs a stronger continuous envelope calculation.

## History

- 2026-09-07: Proposed for the bounded #51 implementation.
