# Contributing

Infrastructurio is early in development: main restarted rail-first on 2026-09-26 and holds
only the M4 skeleton. Contributions should help validate the living-diorama premise while
keeping the simulation deterministic, understandable and replaceable.

## Before starting work

1. Read the [README](README.md), the current milestone in the [roadmap](ROADMAP.md) and its
   contract in the [prototype plan](docs/prototype-plan.md).
2. Find the existing issue. M4 work is tracked under keys D1–D13 in the
   [backlog](docs/backlog.md); each issue names its parent epic, dependencies and
   acceptance criteria.
3. For uncertain work, create a research issue with a falsifiable question.
4. Keep changes small enough to explain and verify.
5. Agents follow [CLAUDE.md](CLAUDE.md) (other agents start at [AGENTS.md](AGENTS.md), which
   routes to it), plus the nested guide for the area they touch ([docs](docs/CLAUDE.md),
   [src/core](src/core/CLAUDE.md), [src/render](src/render/CLAUDE.md)).

## The player's role

The player **only designs infrastructure**: track, turnouts, signals, stations and
platforms, depots, bridges, tunnels and, later, roads. Services run autonomously and stay
inspectable.
- Never add or design player train purchase, fleets, lines, timetables, dispatch, subsidies,
  scripted endings, bottlenecks or growth; no buy/dispatch UI or fake passenger/cargo counts.
- When autonomous behaviour could confuse a player, make it explainable ("why is this train
  waiting?") rather than handing the player control of it.
- The game is forgiving: rejected actions give one reason and a hint for fixing it.

## Working principles

- Keep simulation rules independent from rendering and UI
  ([ADR 0002](docs/decisions/0002-separate-simulation-from-presentation.md)).
- Prefer deterministic behaviour; use seeded randomness only for scenario generation.
- Add behavioural tests for construction, signalling, routing and service rules.
- Expose reasons for simulation decisions instead of hiding them in implementation details.
- Profile before introducing low-level optimizations.
- Record consequential technical or design decisions as ADRs ([Decisions](#decisions)).

## Determinism and the core boundary

`src/core` is the deterministic, DOM-free simulation ([architecture](docs/architecture.md),
[ADR 0012](docs/decisions/0012-tick-units-determinism.md)).
- It imports nothing outside `src/core`, and uses no `Math.random`, `Date`, `performance`,
  console, `window`/`document`/`globalThis`, timers, `structuredClone` or `for…in`.
- Trigonometry, `pow`, `exp`, `log` and `hypot` appear only in
  `src/core/geometry/{sample,clearance,templates}.ts`.
- Simulation quantities are integers (mm, mm/s, mm/s²) advanced in fixed 100 ms ticks. The
  core never sees wall time.
- `src/tools` imports no three and touches no DOM; `src/render` never imports `src/ui`.
- `tsconfig.core.json` and [tests/architecture.test.ts](tests/architecture.test.ts) enforce
  these rules. Never weaken either to make a change pass.
- Once the replay harness lands (D12), every simulation change keeps the replay contract:
  step(1)×N == step(N), save → load → continue equals uninterrupted play, and a command
  log replays to identical checkpoint hashes.

## Evidence discipline

- Label every observation as **automated**, **agent**, **owner** or **participant**.
  Automation is never human evidence, and an owner session is not first-time-player
  validation.
- Record evidence as dated files under `docs/evidence/` (for M4, `docs/evidence/m4/`),
  each with the commit SHA, environment, exact commands, counts, raw output or JSON, and
  explicit non-claims.
- Bound every claim: say what a result does not establish. Preparation is not acceptance,
  and an unmeasured gate is "deferred, not passed".
- Acceptance gates and budgets are predeclared and approved by the owner before anything
  is measured ([M4 gates](docs/evidence/m4/2026-09-26-acceptance-gates.md)), and are never
  retuned after results.
- Agents never perform, simulate or narrate an owner walkthrough or a participant session.
- Road-era evidence at tag `legacy-m0-m4` is history; never cite it as current.

## Decisions

Follow the [ADR workflow](docs/decisions/README.md): copy
[the template](docs/decisions/template.md), take the next unused number on the target
branch and start as **Proposed**. State the scope and evidence. Only the owner marks an ADR
Accepted, and material changes get a new ADR that supersedes the old one explicitly rather
than silently rewriting it.

## Dependencies and legacy code

- Install with `npm ci` routinely. Change dependencies (`package.json`,
  `package-lock.json`) only in a dedicated PR that says why.
- Never restore legacy code or docs to main except through an issue the owner explicitly
  approves. Read them at tag `legacy-m0-m4` with `git show legacy-m0-m4:<path>` (see the
  [archive](docs/archive/README.md)) and re-implement techniques rather than copying them.
- Mighty Tiny Railways is a mood reference only. Never copy its assets, names, UI or
  screenshots into the repo ([art direction](docs/art-direction.md)).

## Issue types

- **Feature:** a player-visible or enabling capability with acceptance criteria.
- **Bug:** observed behavior that differs from an explicit expectation.
- **Research:** an experiment intended to produce evidence or a decision.
- **Design:** a bounded design question that must be resolved before implementation.

## Definition of done

An issue is complete when:

- Its acceptance criteria are met.
- Relevant tests or a reproducible manual verification exist, and the checks pass:
  `npm test`, `npm run typecheck`, `npm run build` and `git diff --check`.
- Player-visible behavior is understandable.
- Evidence the criteria call for is recorded, dated and labelled.
- Documentation is updated when behavior or architecture changed.
- Follow-up work is captured separately rather than hidden in comments.

The owner decides dispositions. A merged PR or a passing check does not by itself close an
issue or accept a milestone.

## Branches, pull requests and commits

- Never commit on or push to `main`. Agent-authored work uses short branches prefixed
  `codex/`; other work uses descriptive prefixes such as `feature/`, `fix/` or `research/`.
- Open **draft** PRs with an explicit base (`gh pr create --draft --base <branch>`), and
  name any PR a stacked branch depends on.
- Base work on current main. A PR whose base predates the 2026-09-26 reset is
  re-implemented on a fresh branch from current `origin/main`, never rebased, force-pushed or
  merged.
- Run the checks before every push (there is no CI) and report exact counts and anything
  skipped. UI changes add a manual `npm run dev` check naming exactly what was exercised.
- **The owner merges every PR personally.** Contributors and agents never merge, including
  their own PRs.
- Never write GitHub closing keywords (close, fix, resolve in any form) before an issue
  number; write `Related #N`.
- Commits describe an observable change or decision.
