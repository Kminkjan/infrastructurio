# M4 acceptance disposition — 2026-09-06

Assessed against the current GitHub issue bodies and comments after merged PR #48
`f18878bd8b817132a0eb00409099542f8cb71cfd`. This is an agent acceptance assessment,
not a human usability session. Milestone 5 and epic #21 remain open.

## #27 — bounded research acceptance criteria satisfied

| Published criterion | Evidence and disposition |
| --- | --- |
| Deterministic occupancy, following, turning conflicts and queue; connections **or** priority changes outcomes | **Satisfied.** Five behavioral checks pass. Old-footprint exclusion, exclusive conflict reservation and blocked-exit spillback are tested. Identical saturated demand with only priority changed yields 224/0 versus 64/160 completions. Turn conflicts are abstract reservations, not continuous trajectories. |
| Explicit distance, speed, ticks, demand and weights without double counting | **Satisfied.** 7.5 m cells, 0.5 s steps, 15 m/s free motion, timed trip requests and contiguous weight-sized footprints. Per-tick generated = completed + pending + active represented trips; occupancy and completions each count weight once. Goods payload is outside this fixture. |
| Two representation factors versus unweighted reference; conservation and error bounds | **Satisfied with a negative experimental result.** Weights 2 and 4 conserve trips but fail predeclared 5% completions / 10% journey time / 10% peak occupancy tolerances with stated absolute floors. ADR 0003 rejects this compression scheme and retains weight 1. The criterion requires a comparison, not that compression succeed. |
| Named hardware, explicit scale and simulation budget; slow/fast-forward feasibility | **Satisfied for the headless reference.** Apple M5 Pro / 48 GiB / Node 26.7.0; 2,144 active vehicles, 128 directional lanes in 32 disconnected junctions. Five timing repetitions and exact slow/batched replay support 2 ticks/s at 1× and 20 ticks/s at 10×. Independent p95 tick 0.0188–0.0470 ms and batch 0.1762–0.2568 ms meet the provisional 1/2 ms budgets. Worst tick 2.8175 ms shows these are percentile limits. Browser pacing and smooth interpolation are untested. |

Evidence: [method and units](README.md), [original raw results](lane-results.json),
[independent rerun](lane-review-results.json), [source review](evidence-review.md),
[ADR 0003](../../decisions/0003-m4-physical-traffic-reference.md).

Disposition: #27 is ready to close on its research contract; no additional human
or production gate is present in that issue's criteria. This assessment does not
close it implicitly through a PR. GitHub remains authoritative for actual status.
Connected-region routing, signals/merging, edit/cancellation accounting, production
cadence and browser scheduling belong to #29/#31–#34/#38/#39 and require new evidence.
No part of the fixture is authorized for direct production integration by this assessment.

## #26 — remain open

The paired adapters, scripted observations, screenshots and named-hardware results
support the bounded probe. They do not demonstrate human readability, discoverability
or accessible construction. The current application cannot perform these edits
unchanged. ADR 0004 deliberately defers production renderer/camera acceptance.
The new [human comparison workflow](rendering/human-comparison.md) enables collection;
it supplies no participant results. A real session and review of its observations
must precede a renderer/camera conclusion. Integrated region budgets remain unproved.

## #28 — partially satisfied, remain open

The source inventory and old-to-new mappings satisfy the audit portion. Reviewed
geometry/legal-movement/occupancy/snapshot boundaries establish target ownership.
#27 now supplies an accepted research reference in this assessment. The save policy
requires separate storage and explicit legacy access; implementation and v3/v9
non-overwrite tests stay in #38. The retained source branch is not a legacy launcher.

Final migration acceptance still depends on #26. Production cadence, renderer/camera
and connected region/frame targets remain pending. Keep #13–#20 open: their source
history is not fresh release or participant validation. No M5/M6 work begins here.
