# Contributing

Infrastructurio is early in development. Contributions should help validate the game premise while keeping the simulation understandable and replaceable.

## Before starting work

1. Read the [README](README.md) and [current roadmap milestone](ROADMAP.md).
2. Look for an existing issue.
3. For uncertain work, create a research issue with a falsifiable question.
4. Keep changes small enough to explain and verify.

## Working principles

- Keep simulation rules independent from rendering and UI.
- Prefer deterministic behavior and seeded randomness.
- Add behavioral tests for economic and routing rules.
- Expose reasons for simulation decisions instead of hiding them in implementation details.
- Profile before introducing low-level optimizations.
- Record consequential technical or design decisions using the [ADR workflow and template](docs/decisions/README.md). State the acceptance scope and evidence; supersede material decisions explicitly rather than silently rewriting them.

## Issue types

- **Feature:** a player-visible or enabling capability with acceptance criteria.
- **Bug:** observed behavior that differs from an explicit expectation.
- **Research:** an experiment intended to produce evidence or a decision.
- **Design:** a bounded design question that must be resolved before implementation.

## Definition of done

An issue is complete when:

- Its acceptance criteria are met.
- Relevant tests or a reproducible manual verification exist.
- Player-visible behavior is understandable.
- Documentation is updated when behavior or architecture changed.
- Follow-up work is captured separately rather than hidden in comments.

## Branches and commits

Use short branches prefixed with `codex/` for agent-authored work and descriptive prefixes such as `feature/`, `fix/`, or `research/` otherwise. Commits should describe an observable change or decision.
