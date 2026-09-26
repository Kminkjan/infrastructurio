# docs/ — authority, evidence style, ADRs

## Which doc governs (checked 2026-09-26)
- **Status lives on GitHub, not in docs.** Issue comments lag main, so verify on main too. The current M4 pointers are in the root CLAUDE.md, "Where truth lives".
- **Current target docs:**
  - `next-prototype-plan.md` (acceptance contract);
  - `next-prototype-backlog.md` (scope and dependencies; E1–E5/F/R/T/G/L keys map to issue numbers);
  - `vision.md` and `gameplay-loop.md`;
  - the root `ROADMAP.md`.

  The owner agreed this direction on 2026-09-06. The plan's implementation choices are *defaults to test*, not owner decisions.
- **Historical docs:** `roadmap-m0-m3.md`, `m3-vertical-slice-plan.md`, `initial-backlog.md`.
  - Keep them, but never extend them as targets, and never port the M3 guided ending or quarry objective into M5.
- **`research/accessibility-scoring.md`** documents the live legacy scorer and has no scope note. It is not M4 authority; legacy-inventory marks its cache structure "Adapt" for #34/#35.
- **Legacy-build docs:** `technical-architecture.md`, `performance-strategy.md`, `simulation-model.md`.
  - They accurately describe the Millford build on main (for example, save format v3).
  - For the new prototype, only their dated "M4 reviewed research boundary" sections carry forward, plus the principles the plan keeps: a deterministic, renderer-independent simulation, typed commands and seeded decisions (ADR 0002).
  - Their aggregate-flow and decorative-animation sections are legacy behaviour.
  - The "Worker protocol" in `technical-architecture.md` never existed as written: there is no SimulationMessage, RenderSnapshot, remove-entity, set-policy or `src/worker/`.
  - The real command types are in `src/shared/simulation.ts` (legacy) and `src/experimental/construction/model.ts`. There is no Web Worker, and none is justified yet.
- **`glossary.md`** predates the direction (last changed 2026-08-09).
  - Its "Representative vehicle" (a renderer sample of aggregate flow) is legacy. Current docs use the term for a simulation-owned lane occupant, which may stand for several trips only if weighting preserves queues and accounting.
  - ADR 0003 keeps weight 1 as the research reference, and production representation stays open.
  - Define new terms in the glossary.

## Planning guardrails
- **Excluded from plans:**
  - player fleets, vehicle purchase, lines, timetables, dispatch, subsidies and service requests;
  - scripted endings, bottlenecks or growth;
  - every-citizen agents, *comprehensive* production-chain economies, huge maps and a broad mode catalogue (freight, industry and goods accounting stay in scope);
  - municipal services, multiplayer, utilities and mods;
  - an unmeasured engine or renderer rewrite in M4.
- **M4 is an enabling milestone:** evidence, ADRs, measured budgets, a legacy audit, and the construction proof (#50 → #55). M5 is the first integrated playable loop, and M6 rail starts only after M5 validation.
- **Freeform vs grid-assisted construction for M5 is unresolved.**
  - The owner direction says freeform: the vision, the plan's decision record and ROADMAP M5.
  - The owner-approved 2026-09-06 refinement (plan, ROADMAP M4, epic #50) makes the M4 proof grid-assisted, and says not to inherit freeform assumptions by default. Proposed ADR 0005 covers the M4 experiment only (snapping, curve fitting, geometry and clearance bounds) and decides nothing about M5.
  - Write neither model as decided for M5.
- **M3 issues:** leave #13–#20 as they are until the #28 audit establishes completion or supersession. Even then, propose the change in a comment; closing, reopening or re-milestoning them is owner-only.

## Writing evidence and status
- **Date and source statements.** Date every status or evidence statement ("Review update (2026-09-06):"), and name the baseline SHA, branch, commands, pass counts and environment.
- **Bound every claim.** State what it does not establish: "bounded research", "Preparation is not acceptance", "deferred, not passed", "does not close #N", "GitHub remains authoritative".
- **Label each observation's source:** agent/automated, owner or participant.
  - An owner session is not first-time-player validation.
  - Automation, projected-coordinate scripts and agent-typed notes are never participant evidence.
  - A deferred human gate stays open.
- **Keep fresh checks separate from historical runs.** The recovery note in `research/m4/construction-controls.md` is the model.
- **Separate measured, forecast and unknown values.** Missing samples are absent, not zero. Quote timings only with named hardware and workload, and keep the movement and browser envelopes separate.
- **Never rewrite superseded docs.** Add a dated `> Scope note` or append a dated section; fix factual errors with a dated note.
- **Never write that an issue, epic, milestone or human gate is closed or accepted.** Propose the disposition instead.
- **When an issue's status moves, update together:**
  - its dated evidence record under `research/m4/`;
  - the backlog item's dated update line (#50–#55 are table rows, so add a dated line under the focused-epic section);
  - the affected architecture boundary sections;
  - the ADR index, if an ADR's status or scope changed.

  Touch ROADMAP M4 and README "Current milestone" only when milestone scope or sequencing changes. Then comment on the affected issues.
- **Style:** en-dash ranges (M0–M3, #51–#54) and → for sequences. Use relative links for repo files and absolute github.com URLs for issues, PRs and milestones. All relative links resolved on 2026-09-26. The they/them and no-names rules are in the root CLAUDE.md.

## ADRs (`decisions/`)
- **Numbering:** copy `template.md` to `NNNN-kebab-name.md`, using the next unused number *on the target branch* (check with `git ls-tree --name-only <branch> docs/decisions/`; 0008 on main as of 2026-09-26). Record the check in History.
- **Status:** start **Proposed**. Any status change (Accepted, Rejected, Superseded) needs the owner's explicit instruction in the current conversation, naming the ADR.
  - This overrides `decisions/README.md` step 3 ("existing user authorization can establish a decision without another permission round").
  - Fill Decision authority with the date and a link. A merged PR is not acceptance.
- **Scope** is its own field: experiment, prototype or production, plus the affected systems. "Accepted for research" never means production.
- **Index:** add a row to the `decisions/README.md` index, summarizing scope without widening it.
- **Proposed ADRs:** you may append new dated findings sections ("— YYYY-MM-DD (still Proposed)", as in 0006), but never edit an earlier dated section.
- **Accepted ADRs are history.** A material change needs a new ADR, linked both ways. The old one becomes **Superseded** (naming any partial scope) only once the replacement is Accepted.
- **Content:** fill every template section, separating observed from inferred. Include a legacy-reuse assessment, what stays open, and "Revisit when". An ADR is not evidence that implementation passed, and it closes no issue.
- **0001–0004** predate the template and lack its fields; 0003 and 0004 also fold scope into their status strings. Keep their wording.
