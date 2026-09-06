# Preliminary M4 legacy inventory

Read-only inspection on 2026-09-06 for #28. **Not the completed migration audit:**
#26 now has a [paired rendering experiment](rendering/README.md) and a provisional
research reference; #27 has the bounded lane study. Both still need review; human
comparison and the production renderer/camera choice remain open.
No old issue has been closed, superseded or relabelled on the strength of this inventory.

## Evidence boundaries

- Research worktree starts exactly at PR #45 / `de77568257d22949684b9e4298947d755c11646e`.
- `git worktree list` locates the actual original checkout at
  `/Users/krisminkjan/Documents/CodexRepos/infrastructurio`, on
  `codex/issue-19-release-gate`, HEAD `18dc5ee`.
  The separate `Documents/ChatGPT/Infrastructurio` directory is not that checkout.
- Original branch commits include `43659e6` supply chain, `0ea3379` finance,
  `125c929` rail, `efe247b` operators, `93b59da` scenario, `64574eb` explanations,
  and `f80d24e` release validation. These implementations are not in the M4 baseline.
- The original checkout has 10 modified files (367 insertions / 13 deletions at
  inspection): `src/app/{App.tsx,app.css}`, `src/rendering/{index.ts,map-features.ts,
  map-features.test.ts,world-renderer.ts}`, `src/simulation/scenario/{millford-scenario.ts,
  millford-scenario.test.ts}`, and `src/simulation/{simulation.ts,simulation.test.ts}`.
  Inspected diffs include normalized snap preservation and changing supply-chain
  activation feedback from delivered goods to viable routes. No cherry-pick, reset,
  clean, save import, test run or file edit was performed in that checkout.
- GitHub milestone 5 is open, with four open issues (#21/#26/#27/#28).
  Issues #13–#20 were read individually; all were open on inspection. #20 has no
  milestone. The release report on the old branch is evidence of prior reported
  checks, not newly performed M4 validation or a first-time-player session.

## Candidate disposition and issue mapping

Paths below are repository-relative. M3-only paths refer to the original branch,
not to files currently present in this worktree. These are candidates for #28 review.

| System / old issue | Concrete implementation evidence | Candidate boundary / new work |
| --- | --- | --- |
| Deterministic simulation and commands (M0–M2) | `src/simulation/simulation.ts`, `src/shared/simulation.ts`; typed commands, clock/state snapshots and behavioral tests | Retain separation and deterministic command pattern; adapt time units and movement state for #29/#32/#33/#38. Do not reinterpret old hour ticks as movement ticks. |
| Road graph (M0–M2) | `src/simulation/transport/road-network.ts`: `segmentIntersection`, pairwise splits in `createRoadNetwork`, 2D `Point`, aggregate `applyRoadLinkFlows` | Replace planar topology/capacity assumptions in #29/#31/#33. Reuse validation/routing test patterns, not elevation-blind crossing connectivity. |
| Vehicle rendering (M0–M2) | `src/rendering/representative-freight.ts`: 20 tons/icon, elapsed-time route sampling; `world-renderer.ts` owns animation | Replace movement authority with simulation snapshots in #33/#34. #27 rejects naive weighted physical reuse. ADR 0004 retains Pixi plan view for research; production choice awaits #26 review. |
| Accessibility and development (M1–M2) | `src/simulation/growth/{accessibility,development,millford-accessibility,millford-development}.ts`; dependency caches, delayed construction, explanations | Adapt cache/slow-decision structure for #34/#35; replace generalized aggregate travel costs with measured journeys, distinct land uses and sustained feedback. Existing geography is an optional seed. |
| Supply chain #13 | M3 `src/simulation/economy/stone-supply-chain.ts`: daily storage/processing, `assignFreight` based on route cost, bounded outputs | Adapt inventory/limiting-factor patterns for #32/#35. Aggregate assigned/shipped tons are not evidence of physical delivery; authored quarry chain is not the new target. |
| Finance #14 | M3 `src/simulation/economy/infrastructure-finance.ts`: quotes, polygon land cost, transaction state; finished-stone revenue and recurring bond penalties | Retain quote/commit and atomic rejection patterns; replace transport revenue and recalibrate recovery/maintenance for regional funding in #37. |
| Rail #15 | M3 `src/simulation/transport/rail-network.ts` and tests; graph plus terminal capacity/transfer time | Defer production rail to #40/#41 after G5. Adapt graph/terminal ideas; replace straight, aggregate-capacity rules with track geometry, blocks, consist occupancy and reachable station access. |
| Operators #16 | M3 `src/simulation/transport/freight-operators.ts`: eight-hour cadence, cheapest generalized-cost candidate, aggregate flows, anchored terminal access/egress = 0 | Adapt explanation/candidate schema for #32/#42/#43. Replace with autonomous departures/service viability; no player service-price or dispatch requirement. No existing train blocking/frequency proof. |
| Guided ending #17 | M3 `src/simulation/scenario/millford-scenario.ts`, tests and uncommitted activation change | Defer as legacy-only; do not port the prescribed ending/stability objective into #39's open-ended loop. |
| Explanations #18 | M3 `src/simulation/explanations.ts`, tests; candidate cost comparison, authoritative finance/development inputs | Adapt schemas and accessible textual explanation patterns for #34/#35/#42. Feed actual movement and development causes rather than inferred aggregate delay. |
| Release gate #19 | M3 `src/testing/m3-release-gate.test.ts`, `docs/m3-release-validation.md`, `fixtures/m3-target-scale-save.json`; report covers 12 roads, 6 tracks, 10 decorative vehicles | Retain reproducible variant/save-test approach. Replace validation scenarios for #39/#44. Old 20–30-minute script and frame report cannot certify M4/M5 traffic scale. Not rerun here. |
| First-time users #20 | GitHub issue requests at least three first-time players and six comprehension questions | Keep open as M3 follow-up; #26 interaction observations and #39/#44 human validation need their own performed sessions. No participant data collected here. |
| Persistence | Baseline `src/persistence/save-game.ts` writes v3; original M3 writes v9 with v1–9 validators. Both use IndexedDB `infrastructurio` / `saved-games` | Adapt validation patterns for #38, not current payloads. Proposed explicit legacy separation below; no loader changes in this research. |

## Proposed migration boundary, pending #26 and #28 review

Separate four layers: authored curves/elevation/lane identities; derived legal
lane movements and conflicts; dynamic simulation-owned vehicles/reservations/demand;
and immutable render snapshots with interpolation. A crossing on the screen does
not establish a legal connection. Demand timestamps, completion events and
unserved/cancelled states must be conserved independently of any display sampling.

Keep legacy saves as explicitly labelled Millford scenario data, with a separate
new scenario ID and storage namespace for M5. Do not feed v3 or v9 payloads to a
new lane model or silently drop unknown fields. Import should recognize legacy
versions and explain that they need the legacy build, preserving/exporting original
bytes. This is a proposed policy, not an implemented compatible legacy launcher;
#38 must test non-overwrite, unsupported-version rejection and actual legacy access.
The old branch remains available and has not been merged into the new baseline.

Movement uses fixed small steps; demand, accessibility and development use explicit
slower clocks. #27's 0.5 s cell tick is only the research reference. Exact production
movement, demand, smoothing and development intervals remain unselected. Preserve
all steps during time acceleration. Measured disconnected-kernel cost does not
justify a worker migration now; connected routing, browser and render/snapshot
costs must be included before revisiting. The paired #26 study supplies browser-only scene measurements and provisional
renderer/camera ADR 0004. Its synthetic icons do not integrate this movement model.
Final region/frame budgets and production rendering acceptance remain open; these
dependencies prevent marking #28 complete.
