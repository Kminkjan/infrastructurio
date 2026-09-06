# M4 evidence: first lane-traffic experiment

Recorded 2026-09-06 for [#27](https://github.com/Kminkjan/infrastructurio/issues/27).
Baseline verified: `de77568257d22949684b9e4298947d755c11646e` (PR #45), which was
exactly this isolated worktree's HEAD before research. No M5 gameplay is integrated.

## Reproduce

From the repository root, using Node >=20.19:

```sh
npm run test:m4
npm run research:m4:lanes -- /tmp/m4-lane-results.json
```

No dependency installation is needed for these two commands. The script writes
a JSON report to its argument (or stdout without one). Compare deterministic
`comparisons`, not timestamps or timings. The committed [raw report](lane-results.json)
contains source SHA-256 hashes, hardware, all comparisons and five timing repeats.
The model and runner are in `experiments/m4`; they have no application imports.
The separate `.checks.mjs` name prevents Vitest from trying to run Node's test suite.

## Falsifiable questions and method

1. With the same geometry and demand, does priority alone change journey outcomes?
2. Can spatial platoons of 2 or 4 represented trips preserve individual-vehicle
   results within 5% completed trips, 10% fully drained mean journey time (minimum
   tolerance 1 second), and 10% peak approach occupancy (minimum 2 trips)?
3. What does the isolated movement kernel cost at approximately 2,000 active
   physical vehicles and 128 directional lanes on this machine?

Bounds were entered in the runner before the first comparison run. Every lane
and demand/priority case must pass; a conservation pass does not imply acceptable
traffic dynamics. For zero reference completions the denominator is 1, so even
one newly completed trip fails the completion comparison. This is a strict
absolute check at zero, not a meaningful percentage estimate.

Two incoming lanes each lead through one shared exclusive conflict area to their
own outgoing lane. Geometry is 300 m approach + 30 m conflict + 300 m exit.
There is one legal movement per incoming lane, interpreted as conflicting turns;
turn paths are abstract reservations, not traced curves. Each 7.5 m cell contains
one car plus its following space. At the fixed 0.5 s tick, an unobstructed vehicle
moves one cell (15 m/s). A follower cannot enter its leader's old footprint.
The conflict admits only one token at a time; its reservation remains until the
whole token has cleared, with conservative tick-boundary release. The outgoing
lane can block the conflict and spill back into the approach. There is no
injected capacity multiplier, aggregate link delay or renderer-owned movement.

Demand lasts 1,200 ticks (600 s), with one requested trip per lane every [20,40]
ticks (360/180 trips/hour) or [3,7] ticks (2,400/~1,029 trips/hour). Arrivals start
at tick zero; both priority alternatives use the exact same departure schedule.
The saturated case creates 400/172 trips. No random seed is needed for this
periodic fixture. Phase sensitivity, stochastic demand and fairness are untested.
Strict priority can starve a lower-priority movement; that is an observed limitation,
not a proposed production fairness policy.

Each requested trip retains its departure timestamp, including off-network waiting.
For weight w, requests accumulate into a token occupying w contiguous cells.
A final short batch is flushed after demand stops. Occupancy is counted once by
footprint; completion adds w represented trips once. Speed is not scaled and no
extra weight-based capacity divisor is applied. This tests one plausible spatial
batching scheme, not all possible representative-vehicle models. An entered
platoon's front is w−1 cells ahead of its tail at entry, another batching artifact.

At every comparison tick:

`generated = completed + pending admission + active represented trips`

No cancellation exists in this experiment. Every case is then drained, checking
that every generated trip eventually completes. Freight goods, routing, cancelled
trips and network-edit accounting still need their own evidence in #32/#33.
Journey duration runs from request to full exit and includes admission/batching
wait. Horizon reports include unfinished ages and missing samples as null. Drained
means avoid survivor bias. Peak approach occupancy includes moving vehicles;
`maxStoppedTrips` and `stoppedTripSeconds` separately count stopped physical trips,
excluding off-network admission waiting.

## Results and decision

Under saturated demand, changing only priority changes the individual-vehicle
600-second completions from **224/0** (lane 0 priority) to **64/160** (lane 1 priority).
The total is 224 in either design: priority reallocates service, it does not create
capacity. Drained mean journey times change from **242/957 s** to **634.81/43.50 s**.
Blocked-exit tests show zero completions and upstream admission queues, followed
by complete drainage after reopening.

Both weighting factors fail the agreed bounds. With lane 0 priority, weight 2
completes 372/0 instead of 224/0; weight 4 completes 372/156. At low demand,
weight 2 adds 5/7.5 seconds to the drained means and weight 4 adds 15/27.5 seconds.
Batching amortizes the fixed conflict traversal cost when crowded and delays
formation when quiet. Conservation alone therefore cannot justify compression.

**Decision:** reject this spatial-platoon compression scheme. Keep weight 1 as the
reference for subsequent M4/M5 movement work. Do not copy the old renderer's
20-tons-per-icon convention into physical occupancy. See the bounded
[decision record](../../decisions/0003-m4-physical-traffic-reference.md).

## Measured cost and provisional envelope

The raw report names Apple M5 Pro, 18 logical CPUs, 48 GiB RAM, arm64,
macOS 26.6.2, Node v26.7.0. These are local measurements, not a broad hardware claim.
The workload is 32 disconnected junction replicas, 128 directional lanes,
2,144 peak active weight-1 vehicles and 14,320 peak pending trips during the timed
single-tick window. Each of five repeats warms for 600 ticks, measures 1,200 ticks,
and separately samples snapshot construction and JSON serialization every 10 ticks.
After that window, 100 batches of 10 ticks are timed and compared against an
identical single-tick replay. Pending requests continue growing during this
finite stress run; the fixture is not a bounded long-running demand store.

| Operation | Range of per-repeat p95 | Worst observed sample |
| --- | ---: | ---: |
| One tick, all 32 junctions | 0.0177–0.0442 ms | 0.2835 ms |
| Ten ticks, all 32 junctions | 0.1815–0.2543 ms | 0.6193 ms |
| Construct snapshot | 0.0928–0.1737 ms | 0.2808 ms |
| Serialize snapshot | 0.0673–0.0782 ms | 0.2734 ms |

Largest sampled JSON snapshot: 90049 bytes.

Set a **provisional movement-only budget** of p95 <=1 ms per tick and <=2 ms per
10-tick batch at 2,000 active vehicles / 128 directional lanes on this reference
machine. The measured margin supports keeping the next movement experiment on
the main thread; it does not justify a worker migration or a final region budget.
Snapshot construction and serialization each get a provisional p95 <=1 ms guardrail.
These intentionally loose thresholds are decisions made from the observations,
not acceptance bounds retroactively used to validate weighting.

At 1×, this coarse model requires 2 ticks per wall second; at 10× it requires 20.
The measured 10-tick batches and exact replay support headless acceleration
feasibility. Slow stepping and batched stepping produce identical state. No browser
scheduler, render interpolation, smooth slow motion or real-time frame performance
has been measured. The 0.5 s cell discretization is a research simplification;
continuous curves, acceleration and a finer production tick require remeasurement.

## Coverage and remaining gates

Five behavioral checks cover conservation/collision exclusion at every tick for
weights 1/2/4 and both priorities (including partial final batches), priority-only
causality, blocked-exit spillback/recovery, batched and copied-state replay, and
free-travel units/missing samples. Existing application tests and build are run
separately. A structured clone is not a production save/load proof.

This is bounded #27 evidence ready for review; the issue remains open. It does not
prove realistic driver behavior, merging/lane changes, signals, connected-region
routing, development, goods delivery, or M5 acceptance. No human validation occurred.

[#26](https://github.com/Kminkjan/infrastructurio/issues/26) is still pending:
no paired renderer harness, screenshots, task observations, browser frame timings
or renderer/camera decision are claimed by this work. The existing renderer was
inspected as legacy evidence only. Its S-curve/elevated-crossing comparison is the
next independent experiment. Consequently [#28](https://github.com/Kminkjan/infrastructurio/issues/28)
remains dependent on #26 and reviewed #27 evidence; its [inventory](legacy-inventory.md)
is preliminary. M4 and epic #21 remain open.
