# Architecture and design decision records

ADRs preserve consequential choices, their evidence and tradeoffs. Issues track work;
milestones track acceptance; ADRs explain why a direction was chosen. An accepted
ADR does not by itself complete an issue or milestone.

## Decision index

| ADR | Status | Scope |
| --- | --- | --- |
| [0001 — Build the prototype for the web](0001-web-based-prototype.md) | Accepted | Initial browser/TypeScript/Vite/Pixi/React prototype direction; production renderer choice is being revisited through 0004. |
| [0002 — Separate simulation from presentation](0002-separate-simulation-from-presentation.md) | Accepted | Simulation authority and presentation-independent commands/snapshots. |
| [0003 — Retain individual physical vehicles as the M4 reference](0003-m4-physical-traffic-reference.md) | Accepted, bounded research | Weight-1 lane fixture; tested spatial-platoon factors rejected. Production traffic design remains open. |
| [0004 — Keep Pixi plan view as the bounded editing reference](0004-m4-renderer-camera-reference.md) | Accepted, bounded research | Paired editing experiment only. Production renderer/camera choice remains open. |
| [0005 — Bound grid-assisted approaches and automatic curves](0005-m4-grid-and-automatic-curves.md) | Proposed | #51 experimental snapping, fitting, geometry and clearance limits. |
| [0006 — Own construction identities and edits in the model](0006-m4-authored-identities-and-edit-boundaries.md) | Proposed | #51 command/snapshot ownership and #53 section/override extension proposal. |

Read each record's scope and limitations before applying it. Earlier decisions are
not permanent constraints when new evidence or an explicit product direction warrants
reconsideration.

## When to write an ADR

Record choices that shape multiple components or materially constrain future work:
construction geometry, lane/topology ownership, renderer/camera, simulation cadence,
vehicle representation, persistence compatibility and major dependencies. Include
consequential interaction-design choices when they constrain architecture. Routine
implementation details belong in code or the relevant issue.

## Workflow

1. Copy [the template](template.md) to `NNNN-short-decision-name.md`, using the next
   unused four-digit number. Check the target branch before allocating a number.
2. Start as **Proposed**. Link the issue, relevant evidence and alternatives; state
   whether the decision applies to an experiment, the prototype or production.
3. Review through the normal PR process. Mark **Accepted** only when a concrete
   decision has been made; record its date and the discussion or PR establishing it.
   A merged proposal remains proposed unless acceptance was explicit. Existing user
   authorization can establish a decision without another permission round.
4. Add the record to this index. Update affected architecture/planning docs and issue
   tracking without treating the ADR as evidence that implementation or validation passed.
5. Preserve accepted decisions as history. Correct factual errors with a dated note;
   for material changes, create a new ADR and link it in both directions. Mark the old
   record **Superseded** once its replacement is accepted, identifying partial scope
   if some of the original decision still applies.

Statuses: **Proposed**, **Accepted**, **Rejected**, **Superseded**. Scope is a separate
field; “Accepted for research” never means production acceptance. Historic records
retain their original wording; the index summarizes it without expanding its scope.

## Upcoming construction decisions

The grid-assisted construction proof should explicitly resolve grid constraints,
automatic curve rules, editable road sections/transitions and lane connection
ownership. These are topics for proposed ADRs backed by the construction experiment,
not decisions accepted by adding this workflow. The deferred human comparison remains
unperformed, and existing M4 acceptance gates remain open.
