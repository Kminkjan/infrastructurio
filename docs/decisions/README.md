# Architecture and design decision records

ADRs preserve consequential choices, their evidence and their trade-offs.
- Issues track work, milestones track acceptance, and ADRs explain why a direction was chosen.
- An accepted ADR does not by itself complete an issue or a milestone.

## Decision index

| ADR | Status | Scope |
| --- | --- | --- |
| [0001 — Build the prototype for the web](0001-web-based-prototype.md) | Accepted | Browser, TypeScript, Vite and React direction. Its PixiJS renderer choice is replaced by 0009 (rail-first reset, 2026-09-26). |
| [0002 — Separate simulation from presentation](0002-separate-simulation-from-presentation.md) | Accepted | The simulation is authoritative and presentation-independent, using commands and snapshots. Still in force. |
| [0003 — Retain individual physical vehicles as the M4 reference](https://github.com/Kminkjan/infrastructurio/blob/legacy-m0-m4/docs/decisions/0003-m4-physical-traffic-reference.md) | Accepted, bounded research (archived) | Road-era lane fixture. Its principles carry forward as knowledge; the file is at tag `legacy-m0-m4`. |
| [0004 — Keep Pixi plan view as the bounded editing reference](https://github.com/Kminkjan/infrastructurio/blob/legacy-m0-m4/docs/decisions/0004-m4-renderer-camera-reference.md) | Accepted, bounded research (archived); superseded by 0009 | Road-era paired editing experiment. |
| [0005 — Bound grid-assisted approaches and automatic curves](https://github.com/Kminkjan/infrastructurio/blob/legacy-m0-m4/docs/decisions/0005-m4-grid-and-automatic-curves.md) | Withdrawn (2026-09-26) | Road-era construction experiment, abandoned because the direction changed. |
| [0006 — Own construction identities and edits in the model](https://github.com/Kminkjan/infrastructurio/blob/legacy-m0-m4/docs/decisions/0006-m4-authored-identities-and-edit-boundaries.md) | Withdrawn (2026-09-26) | Same. |
| [0007 — Present the isolated construction tool with an SVG plan editor](https://github.com/Kminkjan/infrastructurio/blob/legacy-m0-m4/docs/decisions/0007-m4-construction-plan-editor.md) | Withdrawn (2026-09-26) | Same. |
| [0008 — Archive the road-era build and restart main rail-first](0008-archive-road-era-and-restart.md) | Accepted | Repository reset, the legacy tags and the ADR dispositions above. |

- Read each record's scope and limitations before applying it.
- Earlier decisions are not permanent constraints when new evidence or an explicit product direction warrants reconsidering them.
- Archived records live at tag `legacy-m0-m4` (see [the archive README](../archive/README.md)).

## When to write an ADR

Record choices that shape several components or materially constrain future work. Examples:
- track geometry and lattice rules;
- signalling and reservation semantics;
- simulation cadence and determinism;
- renderer, camera and art pipeline;
- vehicle and service representation;
- persistence compatibility;
- major dependencies.

Include consequential interaction-design choices when they constrain the architecture. Routine
implementation details belong in code or in the relevant issue.

## Workflow

1. Copy [the template](template.md) to `NNNN-short-decision-name.md`, using the next unused four-digit number on the target branch. Check with `git ls-tree --name-only <branch> docs/decisions/`, because parallel branches collide.
2. Start as **Proposed**. Link the issue, the relevant evidence and the alternatives, and state whether the decision applies to an experiment, the prototype or production.
3. Review through the normal PR process. Mark a record **Accepted** only when the owner explicitly accepts that ADR, and record the date and where the decision was given. A merged proposal remains Proposed.
4. Add the record to this index. Update affected docs and issues, without treating the ADR as evidence that implementation or validation passed.
5. Preserve accepted decisions as history.
   - Correct factual errors with a dated note.
   - For material changes, create a new ADR and link the two in both directions. Mark the old record **Superseded** once its replacement is accepted, naming any partial scope that still applies.

Statuses:
- **Proposed**
- **Accepted**
- **Rejected**: declined on merit.
- **Superseded**
- **Withdrawn**: abandoned because the direction changed, not rejected on merit.

Scope is a separate field; "Accepted for research" never means production acceptance.
Historic records keep their original wording, and the index summarizes them without
expanding their scope.
