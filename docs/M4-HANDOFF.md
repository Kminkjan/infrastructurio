# M4 handoff and continuation script

Updated 2026-09-26. Read this before restarting construction work. GitHub issue
bodies remain authoritative. This is a work handoff, not milestone acceptance.

## Where work stopped

The September 7 controls/lane task hit an account usage limit before publication.
Its independent clone was under `/private/tmp/m4-controls-lanes`; that directory
was absent at the September 26 restart. Historical agent browser observations and
passing tests are retained in the task history, but do not certify recovered bytes.
Recovery must use a durable isolated checkout and fresh checks.

On September 26 the owner authorized consolidation onto main and this handoff.
PRs [#49](https://github.com/Kminkjan/infrastructurio/pull/49),
[#56](https://github.com/Kminkjan/infrastructurio/pull/56), and
[#57](https://github.com/Kminkjan/infrastructurio/pull/57) were merged to main
(`fc90d75` after those three merges):

- #49: frozen-source research server, v1/v2 report verification, paired human-session
  tooling, and formal bounded #27 assessment. The old human exercise is deferred,
  not performed or passed.
- #56: owner-approved construction plan, ADR index/template, and orchestration ledger.
- #57 / #51: renderer-independent construction commands/snapshots, stable road/lane
  identities, automatic curves, grid and elevation validation, atomic edits and undo.

The original local controls commit `51944d1` was never pushed and its Git object
is unavailable. Source-writing history was recovered; original tree identity cannot
be independently proved, although recorded change statistics and construction build
filename match.

Controls/lane source was recovered into durable worktree `8192`, first checkpoint
`2234736`, then integrated with current main. It supplies the standalone editor,
local widening/tapers, meaningful alternative lane targets and coherent undo.
PR [#58](https://github.com/Kminkjan/infrastructurio/pull/58) consolidated this work
onto main at `a8c1c9d` (recovery head `fd40842`). Its dated recovery note separates September 7
browser observations from September 26 fresh tests and browser startup. The full
browser sequence has not been rerun after recovery; #55 owns that verification.

## Remaining milestone work

1. Finish review of #52/#53 if recovery leaves a defect; retain their separate issue
   criteria even though they share implementation. Do not start a competing model.
2. #54: package the existing editor as an empty/resettable reference site with a
   simple unambiguous launcher, target layout, source/environment provenance and
   predeclared review checklist. Preparation is not acceptance.
3. #55: independently execute the sequence and negative cases through ordinary
   visible controls; inspect derived connectivity and exact undo restoration.
   Conduct an actual owner/human walkthrough and record confusion/help separately.
   Automation cannot supply participant evidence. Keep this gate open until done.
4. Feed supported findings into #26/#28 and the proposed construction ADRs. #27 has
   a bounded-research closure recommendation, not an assumed closure. #21 and M4
   retain broader gates. M5 #29–#31 retain production integration/hardening.

Required sequence: **draw two roads → one curved connection → widen one approach
→ assign its lanes → undo each edit to the initial state**. Include invalid
curve/taper recovery and an elevation-separated crossing with no accidental link.
Geometry, lane connectivity or undo defects block acceptance.

## Durable checkout and commands

Use a fresh clone or managed worktree, never the protected original checkout.
For a standalone clone, choose a persistent directory that does not already exist:

```sh
git clone https://github.com/Kminkjan/infrastructurio.git "$HOME/infrastructurio-m4-continuation"
cd "$HOME/infrastructurio-m4-continuation"
git fetch origin main
git switch -c codex/m4-continuation origin/main
npm ci
npm test
npm run test:m4
npm run typecheck
npm run build
npm run verify:m4:rendering -- docs/research/m4/rendering/results.json
npm run verify:m4:rendering -- docs/research/m4/rendering/results-v2.json
```

Commit and push bounded checkpoints to durable branches; do not leave the only copy
of implementation in `/tmp`. Launch the recovered editor with:

```sh
npm run dev:construction
```

Open `http://127.0.0.1:5178/construction.html`. The launcher uses a strict port; if
occupied, stop your identified old server or choose an explicit free port. Do not
run checks against an unidentified process. Reload resets this in-memory experiment.
See [construction controls](research/m4/construction-controls.md) for the ordinary
input sequence, geometry bounds and actual accessibility limitations. Do not mistake the paired-renderer human page for the new
construction workflow. Report verifiers validate recorded research, not new browser
performance or human usability.

## Copy/paste continuation prompt

```text
Continue Infrastructurio M4 from fetched origin/main in an isolated durable
worktree. Read repository instructions, docs/M4-HANDOFF.md, ROADMAP.md,
docs/vision.md, docs/next-prototype-plan.md, docs/next-prototype-backlog.md,
docs/research/m4/orchestration.md, construction handoffs, and docs/decisions.
Read current GitHub milestone 5, #50–#55, #21/#26–#31 and relevant PRs.

Verify what is actually on main before doing work. Reuse the existing isolated
construction model/editor and accepted findings; resolve any recovery defects
before expanding scope. Complete #54 reference-site/review-protocol preparation,
then independently execute #55 automated/model/browser verification. The thin
sequence is draw two roads → curved connection → widen an approach → assign lanes
→ undo, plus invalid curve/taper and disconnected elevated-crossing cases.
Use ordinary visible controls; neither injected state nor a coordinate-projection
oracle substitutes for interaction proof. Record exact source revision/environment,
commands, pass/fail evidence, observed friction, and unresolved defects.

#55 requires an actual owner/human walkthrough. Ask for that concrete walkthrough
only once the runnable artifact and checklist are ready. Do not invent participant
evidence or close this gate on automation alone. Old paired human exercise remains
deferred. Keep renderer/camera and migration decisions #26/#28 scoped and open until
supported; #50 informs them without waiting on final #28. M5 remains separate.

Keep authored identities, derived geometry and legal movements separate; model-owned
commands/snapshots and coherent undo remain authority. Grid construction does not
mandate tile vehicle motion. No growth, finances, rail, full traffic integration,
legacy-save writes or production rewrite. Record consequential choices as scoped
Proposed ADRs until explicitly accepted. No milestone closure is authorized by this
handoff. September 26 merge permission applied to consolidating the existing work;
obtain applicable authorization before merging subsequent new implementation.

Preserve /Users/krisminkjan/Documents/CodexRepos/infrastructurio: never switch,
reset, clean, merge into, test in, or mutate its working checkout, and never import
its uncommitted gameplay. It must remain codex/issue-19-release-gate at 18dc5ee with
ten modified files and binary diff SHA-256
42c4eec5ee1290dd8fbfd62cac7edccce0bf23b53579a12dff50c7877b993841.
Do not mutate another task's checkout. Track commits/PRs/gates accurately and keep
human observations distinct from agent verification.
```

## Verification of the September 26 consolidation

The combined #49/#56/#57 source passed 86 Vitest tests, 25 M4 research checks,
TypeScript/production build, both v1/v2 report verifiers and `git diff --check`.
No new participant session or fresh performance measurement was performed.
After controls recovery, an independent combined run also passed **95 Vitest tests**
(including 22 construction tests), **25 research checks**, typecheck/build including
`dist/construction.html`, and the v2 research verifier. These fresh tests verify
recovered source; historical browser observations are dated in the controls handoff.

Read-only verification confirmed the protected original branch, HEAD, ten-file
change count and exact binary diff hash above.

## Task references

- Orchestration: `01a0780b-1278-7101-906a-af80d77f6f8c`, worktree `380b`.
- Geometry: `01a0780c-39b4-7bd0-93a8-b122fead58fa`, worktree `6d14`.
- Controls/lanes and recovery: `01a07a79-6606-7833-9922-7781d8808d6b`, durable
  worktree `8192`; obsolete temporary path is described above.
- Research handoff: worktree `56ab`, original PR #49 head `e36ea6a`. Its intended
  seven-file documentation additions were separately carried by PR #56; do not
  indiscriminately import its other content.
