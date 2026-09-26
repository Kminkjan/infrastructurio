# docs/research — dated evidence records

These are measured evidence cited by ADRs and issues. Treat them as dated history. General doc and ADR rules are in `docs/CLAUDE.md`, but this file stands alone, because nested guides may load without their parents.

## Immutable artifacts
- **Never edit, regenerate, reformat, move or rename:**
  - `m4/rendering/results.json` (v1), `m4/rendering/results-v2.json` and `m4/rendering/source-v1/**`. `npm run test:m4` reads these exactly, by fixed relative paths, and `source-v1` must keep its internal `experiments/…` and `src/…` layout.
  - `m4/lane-results.json`, `m4/lane-review-results.json` and `m4/rendering/*.png`. No test reads these cited records, so an edit would go **unnoticed**; that makes the rule stricter, not looser.
- New runs go to new files.
- `npm run research:m4:lanes -- <path>` overwrites its target silently. Write to a scratch path, then copy the report to a new file here.
- **Live bytes pinned by the v2 report:**
  - `experiments/m4/rendering/{scene,pixi-view,three-view,study,run-study,serve-study,human-session}.mjs`
  - `experiments/m4/rendering/index.html`
  - `src/rendering/map-camera.ts`
  - the root `package-lock.json`

  The v2 report does not pin `verify-results*.mjs`. Changing a pinned file breaks `test:m4`; `experiments/m4/CLAUDE.md` has the archive-then-reroute route.

## Current vs historical
- **Past records:** never rewrite them. Append a dated "Subsequent …" note or add a new doc, and link both ways (e.g. `evidence-review.md` → `acceptance-disposition.md`).
- **Rendering docs:**
  - Everything in `m4/rendering/README.md` below its opening note describes v1: timings, limits, the line-count table, and the Reproduce steps (`npm run dev -- --host 127.0.0.1 --strictPort`, runner hard-coded to port 5173).
  - The current commands and v2 numbers are in `m4/rendering/human-comparison.md`.
- **Construction docs:** `m4/construction-controls.md` is the current construction contract. `m4/construction.md` is the original #51 record, and its API section is stale.
- **`m4/orchestration.md`:** its dispatch table is history (see its September 26 section and `docs/M4-HANDOFF.md`), but its Acceptance boundaries and Preservation sections still bind.
- **Test counts:** older counts in these records ("15 research checks", "73/86 Vitest tests") are dated. Current counts are in the root CLAUDE.md.
- **`m4/README.md` "no dependency installation":** this holds for `research:m4:lanes` only; `test:m4` needs vite.
- **`accessibility-scoring.md`** covers the live legacy scorer. It is not M4 authority.
- **Milestone numbering:** "GitHub milestone 5" means **M4**, and M5 is milestone 6.

## Writing new records
- **Required contents:**
  - the date, baseline commit SHA and PR/issue;
  - the question, method, bounds, how to reproduce, results, decision and limitations;
  - what was not done (e.g. no participants, no GPU time, disconnected junctions, one named machine).
- **Bounds vs budgets:** declare acceptance bounds before running. Keep them separate from budgets chosen after measurement, and never present a budget as having validated a result.
- **Evidence labels:** label each observation's source as automated/agent, owner or participant. Automated and agent browser runs are never human evidence, and the paired human exercise is "deferred, not passed".
- **Quote results exactly.** These are deterministic fixture outputs, reproducible anywhere:
  - priority-only saturated completions **224/0 vs 64/160**;
  - weights 2 and 4 fail the predeclared bounds, so weight 1 is kept (ADR 0003).
- **Quote budgets only as budgets**, never as results. They are provisional guardrails set after measurement on the named Apple M5 Pro only:
  - **movement:** p95 ≤1 ms/tick, ≤2 ms per 10-tick batch, and ≤1 ms each for snapshot build and serialize (budget set at 2,000 active vehicles, measured peak 2,144; 128 directional lanes; 32 disconnected junctions);
  - **browser:** p95 ≤20 ms frame interval, ≤4 ms CPU update/submit and ≤8 ms edit rebuild (a synthetic 128-strip / 2,144-icon scene). Pixi is a research reference only (ADR 0004).
- **Dispositions:** a doc never closes an issue or milestone. Recommend in the doc and in an issue comment; GitHub records the disposition.
- **Protected checkout:** older records quote read-only hash checks of `/Users/krisminkjan/Documents/CodexRepos/infrastructurio`. Never repeat them, and never touch that path or `~/.codex/worktrees/*/infrastructurio`, whose worktrees point into it.
