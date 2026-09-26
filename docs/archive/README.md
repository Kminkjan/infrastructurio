# Archive: the road-era build

On 2026-09-26 the owner re-imagined M4 as a rail-first "living diorama" and chose to
archive the earlier build rather than migrate it ([ADR 0008](../decisions/0008-archive-road-era-and-restart.md)).
Nothing was lost. Everything below remains available at annotated tags.

| Tag | Points at | Contains |
|---|---|---|
| `legacy-m0-m4` | main immediately after PR #59 merged | The M0–M2 Millford Valley app, the M4 construction proof (`/construction.html`), the M4 lane-traffic and 2D/3D rendering research with committed evidence, ADRs 0001–0007, all road-era planning docs, the M4 handoff and the road-era agent guides (`CLAUDE.md` files) |
| `legacy-m3` | `18dc5ee` (`origin/codex/issue-19-release-gate`) | The unmerged M3 Millford vertical slice (#13–#19). The branch itself is kept too; neither the branch nor the tag may be deleted or force-pushed |

**Road-era evidence is history.** Never cite it as evidence for the new prototype, and
never restore legacy code or docs to main except through an explicit issue.

## Where things went

Browse at `https://github.com/Kminkjan/infrastructurio/tree/legacy-m0-m4/<path>`, or
read a single file locally with `git show legacy-m0-m4:<path>`.

| Former path on main | What it was |
|---|---|
| [`src/`](https://github.com/Kminkjan/infrastructurio/tree/legacy-m0-m4/src) | Millford app: `app/` (React shell), `rendering/` (PixiJS), `simulation/` + `shared/` (deterministic M0–M2 core), `persistence/` (save format v3, IndexedDB), `scenarios/`, `experimental/construction/` (M4 construction proof) |
| [`experiments/m4/`](https://github.com/Kminkjan/infrastructurio/tree/legacy-m0-m4/experiments/m4) | Lane fixture (#27) and paired Pixi/Three.js rendering study (#26) |
| [`docs/research/`](https://github.com/Kminkjan/infrastructurio/tree/legacy-m0-m4/docs/research) | Dated M4 evidence, raw reports, frozen `source-v1/` |
| [`docs/decisions/`](https://github.com/Kminkjan/infrastructurio/tree/legacy-m0-m4/docs/decisions) | ADRs 0003–0007 (dispositions in the [ADR index](../decisions/README.md)) |
| [`docs/`](https://github.com/Kminkjan/infrastructurio/tree/legacy-m0-m4/docs) | `vision.md`, `gameplay-loop.md`, `glossary.md`, `next-prototype-plan.md`, `next-prototype-backlog.md`, `technical-architecture.md`, `performance-strategy.md`, `simulation-model.md`, `roadmap-m0-m3.md`, `m3-vertical-slice-plan.md`, `initial-backlog.md`, `M4-HANDOFF.md` |
| [`CLAUDE.md`](https://github.com/Kminkjan/infrastructurio/blob/legacy-m0-m4/CLAUDE.md) and nested guides | Road-era agent rules (hash-pinned evidence, shared IndexedDB slot, save-version ownership) |

## Reproducing the archived build

Use a durable worktree, never `/tmp`:

```sh
git fetch origin --tags
git worktree add ../infrastructurio-legacy legacy-m0-m4
cd ../infrastructurio-legacy
npm ci
npm test                      # 95 tests in 16 files
npm run test:m4               # 25 research checks
npm run typecheck && npm run build
npm run verify:m4:rendering
npm run verify:m4:rendering -- docs/research/m4/rendering/results-v2.json
```

**Recorded 2026-09-26** on Darwin arm64 with Node v26.7.0, at PR #59 head `64a095d`
(the tree the tag's commit carries), after a fresh `npm ci`, all passed:
- 95/95 Vitest tests in 16 files
- 25/25 research checks
- typecheck and build
- both rendering verifiers
- `git diff --check`

This re-verifies the recorded research only. It is not new evidence.

Old saves may still sit in the browser's IndexedDB database `infrastructurio` on the same
dev origin. New work must use its own database name.

## Carried forward as knowledge (not code)

- ADR 0002 (the simulation is authoritative) stays in force.
- ADR 0003's principles carry into the new design: one physical vehicle per simulated entity, capacity from occupied space, fixed steps under acceleration, missing samples recorded as absent.
- Techniques are re-implemented, never copied:
  - preview/execute/undo with one rejection reason;
  - invariant and replay testing;
  - the blocked-exit fixture, which becomes the chain-signal negative case;
  - ray-plane picking with instance-id lookup.
