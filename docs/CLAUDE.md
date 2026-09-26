# docs/ — authority, archive, evidence, ADRs, style

Rules for every file under `docs/`, plus the root planning docs. The critical rules below
stand alone; repo-wide rules are in the root [CLAUDE.md](../CLAUDE.md).

## Authority order (checked 2026-09-26)

1. **GitHub issue bodies and state** govern scope and status. Docs never hold live status;
   issue comments lag main, so verify there too.
2. **Target docs:** [ROADMAP.md](../ROADMAP.md) (milestone claims) → [vision](vision.md)
   (product and player role) → [prototype plan](prototype-plan.md) (M4 contract and
   exclusions) → [backlog](backlog.md) (D1–D13, dependencies; issue numbers TBD) →
   [ADR index](decisions/README.md).
3. **Accepted ADRs** (0001's web direction, 0002, 0008, 0009) record owner decisions. Where a
   design doc contradicts one, the ADR wins and the doc gets a dated fix.
4. **Design docs:** [architecture](architecture.md), [simulation model](simulation-model.md),
   [art direction](art-direction.md), [gameplay loop](gameplay-loop.md),
   [glossary](glossary.md). Where they rest on Proposed ADRs 0010–0014, they are defaults to
   test, not owner decisions; flag contradictions rather than pick a winner.
5. **Evidence** (`docs/evidence/`, e.g. the [M4 gates](evidence/m4/2026-09-26-acceptance-gates.md))
   records what was measured or predeclared, never what was decided.
6. **Archive** ([archive README](archive/README.md) → tag `legacy-m0-m4`): history only.

The root CLAUDE.md wins over any doc on agent rules.

## Archive rule

- Road-era docs exist only at tag `legacy-m0-m4`. Link them with tag permalinks
  (`https://github.com/Kminkjan/infrastructurio/blob/legacy-m0-m4/<path>`, or `tree/` for
  directories); never link a main path that no longer exists.
- **Never recreate or restore a legacy doc.** Rail-first docs are written fresh, even where a
  road-era doc had the same name (`vision.md`, `glossary.md`, `simulation-model.md`).
- **Never cite road-era evidence as current.** Road-era research used for M6 is source
  material, cited by tag permalink and labelled historical.
- In the [archive README](archive/README.md), extend only the path tables; its "Recorded
  2026-09-26" block is evidence and stays as written.

## Evidence (`docs/evidence/`)

- **Dated files:** `docs/evidence/<milestone>/YYYY-MM-DD-<topic>.{md,json}` (the M4 gates
  fix their report names). Each record carries the SHA, branch, environment (OS, CPU/GPU,
  browser, Node), commands, exact counts, raw data and explicit non-claims.
- **Records are immutable once committed:** never edit, regenerate, move or overwrite a
  measurement record or its raw data (invalid runs are committed too). A correction or re-run
  is a new dated file, at a new SHA, that links the old one.
- **Bounds before measuring:** thresholds, workload, hardware, sample counts and the p95
  definition (s[floor(0.95·n)]) are committed and owner-approved before the first run. A
  gates file follows its own change control ([M4 gates](evidence/m4/2026-09-26-acceptance-gates.md)
  rules 1–4): editable until the owner approves it by name (merging is not approval), then
  changed only through a new dated, owner-approved gates file, frozen after the first run.
  Never retune a bound after results; a missed target is a fail taken to the owner.
- **Source labels:** every observation is **automated**, **agent**, **owner** or
  **participant**. Automation is never human evidence; an owner session is not
  first-time-player validation; agent-typed notes are never participant evidence.
- **Human gates:** agents never perform, simulate or narrate the owner walkthrough or a Look
  Gate, and never write, paraphrase or score the owner's observations or verdict. Agents may
  prepare the build, the start command and a blank record; preparation is not acceptance.
- Missing samples are `null`; unexposed GPU time is "n/a"; an unmeasured gate is "deferred,
  not passed". Quote timings only with named hardware and workload, and keep measured,
  forecast and unknown values apart.

## ADR workflow (`decisions/`)

- **Numbering:** copy [template.md](decisions/template.md) to `NNNN-kebab-name.md` with the
  next unused number *on the target branch*: check `git ls-tree --name-only <branch>
  docs/decisions/`, because parallel branches collide, and record the check in History.
  0003–0007 belong to archived records and are never reused; 0009–0014 are claimed by the
  rail-first architecture docs, so expect 0015 next unless `git ls-tree` shows otherwise.
- **Status starts Proposed.** It becomes Accepted only when the owner explicitly accepts that
  ADR in conversation, naming it; record the date and place in Decision authority. A merged
  PR is not acceptance. Every status change (Accepted, Rejected, Superseded, Withdrawn) is
  owner-only, whatever looser wording another doc uses.
- **Statuses:** Rejected = declined on merit. **Withdrawn** = abandoned because the direction
  changed, not rejected on merit (0005–0007). Superseded = replaced once the replacement is
  Accepted, naming any scope that still applies (0004, and 0001's renderer scope, by 0009).
- **Content:** fill every template section; separate observed from inferred; say what stays
  open and when to revisit. An ADR is not evidence that implementation passed, and it closes
  no issue.
- **Proposed ADRs** take appended "— YYYY-MM-DD (still Proposed)" findings sections (slices
  append 0010–0014 findings); never edit an earlier dated section.
- **Accepted ADRs are history:** fix factual errors with a dated note; a material change is a
  new ADR, linked both ways.
- **Index:** add or update the row in [decisions/README.md](decisions/README.md) whenever an
  ADR is added or its status or scope changes, summarizing scope without widening it. 0001
  and 0002 predate the template: keep their wording.

## Keeping docs in step

- When an issue's status moves, update together: its dated evidence record, the backlog
  item's dated update line, affected architecture or simulation-model sections, and the ADR
  index if an ADR changed. Then comment on the issue. Touch ROADMAP and the README status
  only when milestone scope or sequencing changes.
- When the restructure batch assigns issue and milestone numbers, replace every `TBD` in one
  docs PR (`grep -rnw TBD --include='*.md' . | grep -v docs/archive`), root CLAUDE.md
  included. Exception: once the gates file is owner-approved, leave its TBDs alone (its rule
  4); fill them before approval, or name the numbers in the D13 disposition.
- **Never write that a milestone, issue or gate is accepted or closed.** GitHub records
  dispositions and the owner decides; propose a disposition instead.
- Never rewrite a superseded doc silently: add a dated `> Scope note` or an appended section.

## Style

- **Date status statements** ("as of 2026-09-26") and name SHAs, commands and counts.
- **Bound every claim:** say what it does not establish ("Preparation is not acceptance",
  "deferred, not passed", "does not close #N", "GitHub remains authoritative").
- **People:** "the owner" or "participant", with they/them; no personal names.
- **Formatting:** en-dash ranges (M4–M6, D1–D13, 0009–0014); → for sequences; relative links
  for repo files; absolute github.com URLs for issues, PRs and milestones; tag permalinks for
  legacy files. Every relative link must resolve before you push.
- **Hard-wrap prose at about 90 columns;** tables, links and code may run longer.
- **Dense but lossless; recommend, don't survey.** Give each fact one home and link to it;
  gate thresholds are authoritative only in the acceptance-gates file, and any quoted copy
  says "provisional" and links there.
- **Product guardrails:** describe Mighty Tiny Railways as a mood reference only (link its
  Steam page; no screenshots in the repo), and never document player train purchase, lines,
  timetables or dispatch as features.
