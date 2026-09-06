# Next Prototype: Infrastructure Design and Autonomous Growth

## Decision record

Agreed on 2026-09-06 through four rounds of owner questions: detailed design dominates play; services operate fully autonomously; towns extend constrained local streets that the player can redesign; precise tools have defaults; distinct land uses emerge from accessibility; finances are forgiving; the region is small; roads precede rail within this roadmap; physical traffic affects growth and may use representative vehicles; roads are freeform with grade separation; presentation is selected through 2D/3D evaluation; the first integrated proof is open-ended.

This document is the target contract. README run instructions and existing architecture describe the current build. Implementation choices below are planning defaults to test, not additional owner decisions.

## Playable region

Start with a few settlement seeds, jobs, commercial destinations, industries and outside connections. Reuse Millford geography where useful, but remove dependence on the authored quarry-chain objective sequence. Allow residential, commercial and industrial development at competing viable sites. Local streets must establish actual network access; proximity alone is not connectivity. Towns respect reserved corridors and player-owned infrastructure, expose their street-building reasons, and permit player redesign.

## M4 evidence and decisions

Compare identical tasks in the current renderer and a minimal alternative: draw and reshape an S-curve; select a turn lane; distinguish and edit an elevated crossing; inspect a queue under it. Record readability, interaction errors, implementation cost and measured performance on named hardware. Choose a renderer and camera model through a short ADR; do not precommit to a rewrite.

Build a headless junction experiment where changing only lane connections or priorities changes queues and journey times. Define space, speed, vehicle weights, demand rates and simulation time. Representative traffic must conserve represented trips/goods, use a consistent capacity model and avoid multiplying occupancy by weight twice. Compare at least two representation factors against an unweighted small fixture and record acceptable error bounds.

Choose and record an explicit small-region entity/vehicle target and frame/simulation budgets from measurements. Audit current code and open issues #13–#20: retain, adapt, replace or defer each relevant system. Preserve unrelated working changes. Decide how legacy saves are migrated or clearly separated into a legacy scenario without silently losing data.

## Road proof acceptance

- Draw, reshape, connect and remove curved roads; choose independent lane counts per direction and legal turn connections. Useful presets supply valid defaults.
- Configure priority and a bounded basic signal model. Include a roundabout/merge example using the same network rules; no special throughput bonus.
- Bridges and underpasses cross without connecting. Connections depend on elevation, and invalid slopes/clearances give actionable feedback.
- Vehicles obey lane permissions, following distances, yielding/signals and conflict occupancy. Queues spill back and constrain upstream movements. Network edits have an explicit safe rerouting/removal policy.
- Autonomous passenger and freight demand comes from actual land uses and economic activity. Unreachable trips are unmet demand, not vehicles travelling through disconnected space.
- Experienced travel times, waiting and delivery reliability feed smoothed accessibility. Slower, bounded development generates new trips and can gradually decline.
- Town-built streets respect reservations and ownership; a player redesign cannot be immediately undone by municipal rebuilding.
- Inspect a movement’s queue cause, trip origin/destination and travel time; inspect the winning and rejected development sites using decision inputs.
- Land and forgiving capital/maintenance costs create different tradeoffs. Regional funding is independent of the player owning transport or selling quarry goods; calibrate funding and recovery in the finance issue.
- Save/load preserves causal vehicle and growth state; fixed-seed replay yields the same outcomes. Time acceleration preserves movement/conflict rules rather than skipping them.

## M5 validation scenario

Using the same seed and initial demand, compare two equal-lane-count junction designs and show a repeatable difference in queues or completed journeys. Then run the integrated region: improved access causes development, new development generates additional trips, queues emerge from actual conflicts, and two distinct interventions improve conditions with different costs or side effects. Record before/after metrics and the development explanation. Confirm that doing nothing is a valid continuation and that no scripted bottleneck or forced growth event supplies the proof.

Run a first-time-player session: can the player construct a valid road, identify a queue’s cause, choose a design change and explain a growth outcome without developer coaching? Capture observed confusion and follow-up issues. Automated fixtures supplement, but do not replace, this human validation.

## Rail proof acceptance

Build connected curved tracks, switches, accessible passenger platforms and freight terminals, with bounded block signalling and clearance rules. Reuse geometry tooling where appropriate, not road movement rules where rail differs. Trains reserve/occupy blocks and platforms, wait at conflicts and cannot overlap through an occupied junction.

Autonomous operators evaluate reachable demand and service viability, choose routes, frequency and train size, and dispatch trains. Use bounded templates and a small number of operator archetypes initially; deep business competition is unnecessary. Explain startup, change, withdrawal and absence, with decision cadence and hysteresis. The player supplies no line plan, timetable, vehicles or dispatch commands.

Station access/egress and waiting time contribute to journey cost. Freight transfer takes time and obeys goods accounting. Rail use changes road demand and access to workers, customers or goods, which affects growth. A passing track, platform or throat redesign must improve an observed service limitation through physical operation.

Validate one passenger and one freight service in the small region, plus a station with no viable service. Save/replay the same operator decisions and block-conflict outcomes. Repeat the M5 regression proof after rail integration.

## Architecture transition

Retain deterministic, renderer-independent simulation, typed commands, seeded decisions and explainable outcomes. Current renderer-owned vehicle animation and aggregate link congestion cannot be authoritative for the new movement loop. Move vehicle positions, lane/block occupancy, movement state and measured delay into simulation; render snapshots with interpolation only.

Replace the every-2D-crossing-is-a-junction assumption with geometric and elevation-aware topology. Separate authored geometry, derived legal movement graph and dynamic occupancy. Use fixed movement ticks and slower demand/operator/development intervals with explicit units. Profile before selecting a worker migration or deeper optimization. Update architecture, simulation, performance and save documentation as these implementation decisions land.

## Explicit exclusions

No player fleets, dispatch or timetables. No requirement for every citizen to persist. No comprehensive production-chain economy, large-region scale target, broad mode catalogue or scripted win condition. M4 does not authorize an unmeasured engine rewrite. Advanced rail signalling, electrification and detailed construction logistics remain future decisions.

## Existing backlog disposition

Issues #13–#16 contain reusable supply, finance, rail and operator concepts, but their M3 implementations do not satisfy the new contracts. #17’s prescribed ending is historical scope. #18’s explanations can be adapted. #19–#20’s validation is scoped to M3 and cannot certify M5. Leave their status intact until the M4 audit establishes actual completion or supersession; do not block M4 on finishing the old guided experience.
