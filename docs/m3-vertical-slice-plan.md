# M3 Millford Valley Vertical Slice

> Scope note (2026-09-06): This document describes the M0–M3 foundation. The [next prototype plan](next-prototype-plan.md) supersedes its future product direction. Existing aggregate flows and decorative vehicle animation do not satisfy the new causal traffic contract.

## Playable claim

The complete premise should sustain an understandable 20–30 minute scenario:
the player completes a regional supply chain, sees private activity and
development respond, diagnoses the bottleneck created by that success, and
reshapes the region with a second strategic intervention.

This is an integration milestone. New systems belong in M3 only when they make
that player arc clearer, more consequential, or more replayable.

## Starting situation

The deterministic Millford Valley geography remains the scenario foundation.
The authored starting state adds an old Millford bridge and short approach roads,
but leaves the regional network incomplete:

- Granite Ridge Quarry can produce raw granite but cannot reach a processor.
- A dormant stoneworks near Millford can turn granite into finished stone.
- The Eastern External Market buys finished stone.
- Eastbank and its fertile land occupy the most plausible highway-bypass
  corridor.
- A rail alignment can connect quarry, stoneworks, and market at higher up-front
  cost but with high freight capacity.
- A starting treasury can fund the first connection and one sensible follow-up,
  but cannot fund every maximum-capacity option.

The initial objective is diagnostic rather than prescriptive: inspect the
quarry, stoneworks, market, and incomplete routes before spending.

## Player arc

### 1. Read and connect (minutes 0–7)

The player identifies the missing links and connects the quarry to Millford and
the stoneworks to the external market. Raw granite begins moving to the
stoneworks; finished stone begins moving only after processing capacity and the
outbound route are available.

The objective tracker explains which leg is blocked, what it needs, and the
estimated construction cost before the player commits.

### 2. Observe success (minutes 7–14)

Private freight operators serve viable legs without the player dispatching
vehicles. Revenue enters the regional treasury, Millford gains employment and
accessibility, and delayed residential growth becomes visible. Eastbank remains
a credible alternative rather than a decorative settlement.

The player can accelerate simulation time while retaining access to the causal
explanations behind freight, finances, and development.

### 3. Diagnose pressure (minutes 14–19)

Growing road demand overloads the old Millford bridge. The map and inspector
identify affected supply-chain legs, demand, capacity, delay, route choice, and
the likely consequence of doing nothing. The problem must emerge from the same
authoritative values that produced the successful economy.

### 4. Intervene again (minutes 19–27)

The player chooses among at least three viable responses:

- Upgrade the old crossing: the lowest-disruption option, retaining traffic and
  accessibility in Millford but concentrating maintenance and through traffic.
- Build a highway bypass: a new road route that protects freight reliability but
  consumes costly Eastbank farmland and shifts accessibility away from the old
  center.
- Shift freight to rail: the highest up-front option, requiring terminals and a
  connected corridor but removing substantial freight demand from the bridge.

The options differ through authoritative construction cost, maintenance,
capacity, affected flows, and development accessibility. They are not cosmetic
buttons or scripted outcomes.

### 5. Stabilize and reflect (minutes 27–30)

The scenario reaches a clear success state when, for three consecutive simulated
days:

- both supply-chain legs are served and finished stone reaches the market;
- the Millford bridge is at or below practical capacity, or affected freight has
  moved to another mode;
- infrastructure-enabled regional growth has completed; and
- the treasury can meet current daily maintenance without emergency support.

The ending summarizes the chosen intervention, total capital and maintenance
cost, modal freight split, bridge condition, and which settlement gained or lost
accessibility. It invites replay rather than declaring one solution optimal.

There is no hard loss state. An emergency bond keeps a poor plan recoverable at
the cost of a visible financial penalty, and reset returns to the deterministic
starting state.

## Explanation contract

At every stage the player should be able to answer:

- Who is using this infrastructure, and between which origins and destinations?
- Why did an operator choose road or rail and this particular route?
- What currently limits each production and freight leg?
- Which locations gained or lost accessibility after the intervention?
- What construction and maintenance burden did the decision create?
- What is likely to happen if the player advances time without intervening?

React presents structured explanations produced by the simulation; it does not
recalculate causes from display values.

## Replayability boundaries

The geography, economic rules, and success criteria remain deterministic for the
scenario seed. Replayability comes from network geometry, intervention choice,
timing, and spending. The milestone does not require random events, individual
citizens, player-owned fleets, passenger rail, detailed timetables, or a large
catalogue of industries.

## Target-scale performance contract

The release fixture should cover the densest expected M3 state, including road
and rail networks, two aggregate supply-chain legs, development marks, analysis
overlays, and representative vehicles. The final playtest records:

- headless simulation-step timings at the target object count;
- route-assignment and snapshot timings for a sustained scenario run;
- browser frame-rate behavior during the densest visible state; and
- save/load equivalence for a late-scenario state.

Measured evidence, the reference machine, and any accepted limits belong in the
performance strategy document. Optimization should follow profiling rather than
precede it.

## Delivery order

1. [#13 — Multi-step granite and finished-stone production chain](https://github.com/Kminkjan/infrastructurio/issues/13).
2. [#14 — Construction, maintenance, land costs, and treasury](https://github.com/Kminkjan/infrastructurio/issues/14).
3. [#15 — Rail corridors and freight terminals](https://github.com/Kminkjan/infrastructurio/issues/15).
4. [#16 — Private road/rail operator choice and representative traffic](https://github.com/Kminkjan/infrastructurio/issues/16).
5. [#17 — Guided objectives, recovery, success state, and ending summary](https://github.com/Kminkjan/infrastructurio/issues/17).
6. [#18 — Cross-system explanations and consequence forecasts](https://github.com/Kminkjan/infrastructurio/issues/18).
7. [#19 — Full playtest, performance validation, persistence validation, and hardening](https://github.com/Kminkjan/infrastructurio/issues/19).
