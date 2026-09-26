# CLAUDE.md — Infrastructurio (interim, rail-first reset)

This is an interim guide during the 2026-09-26 reset. The full guide set (root, `src/core`,
`src/render`, `docs`, plus `AGENTS.md`) arrives with the architecture PR. **Live status lives on
GitHub.** This is not a Forge-based repo, so use the global CLAUDE.md's non-Forge paths.

## What this is

A rail-first infrastructure-design game in a stylized Baltic 1900 setting. The player **only
designs infrastructure**. Trains and services are autonomous and inspectable: no player lines,
timetables, dispatch or fleet purchases. M4 = "Living Diorama" (`ROADMAP.md`). The road-era
build is archived at tag `legacy-m0-m4` (`docs/archive/README.md`, ADR 0008).

## Layout and hard rules

- **`src/core`: deterministic, DOM-free simulation.**
  - Imports nothing outside `src/core`: no three, react, `Math.random`, `Date`, DOM, console or timers.
  - No trigonometry outside `src/core/geometry/{sample,clearance,templates}.ts`.
  - Enforced by `tsconfig.core.json` and `tests/architecture.test.ts`.
- **`src/tools`:** pure tool reducers; no three and no DOM.
- **`src/render`:** Three.js only.
  - Never imports `src/ui`.
  - `render/coords.ts` is the only sim ↔ world conversion: sim ENU (x east, y north, z up) → three `(x, z, −y)`.
  - `render/art/palette.ts` is the only colour source.
- **`src/ui`:** React HUD, outside the frame loop. **`src/app`:** wiring and the host loop.
- **Units:** core metres and integer millimetres on a 5 m triangular lattice with 12 headings (`src/core/lattice.ts`).

## Checks (run before every push; there is no CI)

- `npm test`
- `npm run typecheck` (both configs)
- `npm run build`
- `git diff --check origin/main...HEAD`
- For UI changes, add a manual browser check with `npm run dev` and say exactly what you exercised.
- Report exact counts and anything you skipped.

## Git and GitHub

- **Never commit on or push to `main`.** Branch as `codex/<topic>` and open **draft** PRs with an explicit base.
- **The owner merges every PR personally.** Never merge, even your own PRs.
- Never put a checkout, a worktree or the only copy of work under `/tmp` or `/private/tmp`, the session scratchpad included. Push checkpoints early.
- Never write GitHub closing keywords (close/fix/resolve, any form) before an issue number. Write `Related #N`.
- These need the owner's explicit instruction in the conversation, naming the action and target:
  - closing or reopening issues or milestones;
  - ADR status changes;
  - tag pushes;
  - deleting branches.
- zsh: quote URLs containing `?`. Non-TTY: `gh issue view N --json title,state,body,comments`.

## Never

- **Never touch `/Users/krisminkjan/Documents/CodexRepos/infrastructurio`** (the owner's protected M3 checkout) or `~/.codex/worktrees/*/infrastructurio` (its worktrees): no reads, git, tests or imports.
- **Never delete, move or force-push** tags `legacy-m0-m4`/`legacy-m3` or branch `origin/codex/issue-19-release-gate`.
- **Legacy code:** read it only via `git show legacy-m0-m4:<path>`. Never restore it to main, and never cite road-era evidence as current.
- **Never write to IndexedDB database `infrastructurio`** (legacy saves on the same dev origin). New saves need a new database name.
- **Never design** player fleets, lines, timetables, dispatch, subsidies, or scripted endings or growth.
- **Never copy assets, names or UI** from the reference game (Mighty Tiny Railways). It is a mood reference only.
