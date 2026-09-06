# Next Prototype Backlog

Created from the direction agreed on 2026-09-06. GitHub is authoritative for status and discussion; this document preserves scope and dependencies. M0–M3 issues remain historical and are audited by F3. Milestones are delivery gates, not deadlines.

Each epic is a tracking issue with linked child issues. Each implementation issue has a specific proof; closing an epic requires its children and milestone evidence. See [prototype contract](next-prototype-plan.md).

## M4 — Infrastructure Design Foundations

[GitHub milestone](https://github.com/Kminkjan/infrastructurio/milestone/5)

Demonstrate usable detailed construction and causal traffic; select 2D/3D presentation from evidence, define simulation scale and audit M0–M3 reuse. Enables M5; not the integrated playable loop.

### E1 — Epic: Establish infrastructure-design and traffic foundations

[GitHub #21](https://github.com/Kminkjan/infrastructurio/issues/21)

Choose the presentation and simulation approach through bounded evidence before expanding implementation.

#### F1 — Evaluate 2D and 3D for precise infrastructure editing

[GitHub #26](https://github.com/Kminkjan/infrastructurio/issues/26)

Choose presentation based on construction readability and cost.

Depends on: No new-prototype prerequisite.

Acceptance criteria:

- Compare the same S-curve edit, lane selection, elevated crossing and obscured queue inspection in the current renderer and a minimal alternative.
- Record screenshots, interaction observations, hardware and frame timings; compare development cost and accessibility of controls.
- Commit an ADR choosing renderer/camera and documenting tradeoffs; set a measured scene and performance target. No production rewrite is required by this issue.

#### F2 — Prove lane traffic and representative-vehicle accounting

[GitHub #27](https://github.com/Kminkjan/infrastructurio/issues/27)

Establish a simulation model in which detailed junction design changes physical traffic outcomes.

Depends on: No new-prototype prerequisite.

Acceptance criteria:

- A deterministic headless fixture models lane occupancy, following, turning conflicts and a queue; changing connections or priority changes completed trips or travel time.
- Specify distance, speed, movement ticks, demand and vehicle weight units; distinguish represented trips from physical occupancy and avoid double-counted capacity.
- Compare at least two representation factors with an unweighted fixture; record conservation checks and acceptable measurement error.
- Record explicit vehicle/network scale and measured simulation budget on named hardware, plus slow movement and fast-forward feasibility.

#### F3 — Audit legacy systems and define the prototype migration boundary

[GitHub #28](https://github.com/Kminkjan/infrastructurio/issues/28)

Reuse working foundations while replacing assumptions that prevent causal infrastructure design.

Depends on: F1, F2.

Acceptance criteria:

- Inspect code and existing issues #13–#20; document retain/adapt/replace/defer decisions with implementation evidence and old-to-new issue mapping.
- Define geometry, legal movement, occupancy and snapshot boundaries; replace renderer-owned movement authority and planar-crossing assumptions in the target design.
- Record save migration or explicit legacy-scenario support, cadence strategy and any worker decision; preserve unrelated uncommitted work.
- Update architecture/simulation/performance documentation with accepted F1/F2 decisions and reconcile old issue statuses only when evidence supports it.

## M5 — Roads Shape a Growing Region

[GitHub milestone](https://github.com/Kminkjan/infrastructurio/milestone/6)

Prove open-ended detailed road design → autonomous traffic → development → congestion → redesign in a small region, with forgiving finances and inspectable outcomes.

### E2 — Epic: Build expressive road and junction design tools

[GitHub #22](https://github.com/Kminkjan/infrastructurio/issues/22)

Make geometry, lanes, connections and grade separation usable and consequential.

#### R1 — Implement curved road geometry and elevation-aware topology

[GitHub #29](https://github.com/Kminkjan/infrastructurio/issues/29)

Allow expressive road layouts with correct connectivity.

Depends on: F3.

Acceptance criteria:

- Simulation commands create/edit/remove curved roads with independent lane counts by direction and stable authored identities.
- Derive legal connectivity from endpoints/intersections and elevation; an overpass crossing has no accidental junction.
- Validate curvature, slopes and clearances with actionable errors; edits are atomic and rejected edits leave state unchanged.
- Deterministic tests cover curved splits, snapped joins, grade separation and removal.

#### R2 — Build road drawing, snapping and reshape controls

[GitHub #30](https://github.com/Kminkjan/infrastructurio/issues/30)

Make detailed road construction enjoyable and recoverable.

Depends on: R1.

Acceptance criteria:

- Draw, preview, snap, reshape and remove roads using R1 commands; choose directional lane counts with useful presets.
- Show terrain/elevation, cost and invalid geometry before committing; cancellation changes nothing and undo restores an edit coherently.
- Bridge/underpass construction and selection remain legible at crossings in the chosen presentation.
- Record manual checks for curve editing, snapping, zoom, cancellation and undo, including simulation-state consequences.

#### R3 — Edit junction lane connections, priorities and basic signals

[GitHub #31](https://github.com/Kminkjan/infrastructurio/issues/31)

Let players solve turning and merging problems through movement design.

Depends on: R1.

Acceptance criteria:

- Inspect and edit legal incoming-to-outgoing lane movements and priorities with valid automatic defaults.
- Provide a bounded signal-phase model that rejects incompatible protected movements and supports meaningful waiting behaviour.
- Turn-pocket, merge and roundabout examples use the same legal movement/conflict model without arbitrary capacity bonuses.
- Commands, persistence-ready state and tests cover prohibited turns and changed movement permissions; overlays show exact legal paths.

### E3 — Epic: Make autonomous road traffic physically causal

[GitHub #23](https://github.com/Kminkjan/infrastructurio/issues/23)

Turn land-use demand into vehicles whose movement and measured delays affect the world.

#### T1 — Generate autonomous passenger and freight trip demand

[GitHub #32](https://github.com/Kminkjan/infrastructurio/issues/32)

Derive transport use from land uses and economic activity without player vehicle management.

Depends on: F3, R1.

Acceptance criteria:

- Seeded homes, workplaces, commerce and industry create bounded commute/customer/freight demand with explicit units and destinations.
- Route choice respects legal lane access; departures are simulation-owned and unreachable trips remain inspectable unmet demand.
- Represented trips/goods are conserved across departure, arrival, cancellation and network disconnection.
- Tests show that changing destination activity changes demand without a player route or dispatch command.

#### T2 — Simulate lane following, merging, conflicts and spillback

[GitHub #33](https://github.com/Kminkjan/infrastructurio/issues/33)

Make the vehicles responsible for traffic behaviour rather than illustrations of link scores.

Depends on: F2, R3, T1.

Acceptance criteria:

- Fixed-tick vehicles follow legal routes with lane occupancy, following gaps, merges, yielding and R3 signal/conflict constraints.
- Turning queues can block upstream movements; vehicles cannot overlap conflicting protected movements or bypass a blocked lane illegally.
- Network edits follow a documented rerouting/removal policy without teleporting deliveries or losing accounted demand.
- Headless tests cover merge contention, red signals, spillback, rerouting and deterministic time acceleration using the F2 accounting model.

#### T3 — Measure journeys and explain road bottlenecks

[GitHub #34](https://github.com/Kminkjan/infrastructurio/issues/34)

Give players actionable evidence and provide causal inputs to growth.

Depends on: T2.

Acceptance criteria:

- Measure completed journey time, queue delay, throughput, unmet demand and delivery reliability from movement events; distinguish absent samples from zero delay.
- Inspect origins/destinations, route and lane movement, conflict cause and measurement interval; render queues from authoritative snapshots.
- Publish smoothed accessibility inputs with explicit fallback behaviour for unused/new routes and bounded response to temporary queues.
- A same-lane-count comparison fixture attributes differing travel outcomes to connection/priority design rather than an injected link-capacity multiplier.

### E4 — Epic: Close the road design and autonomous growth loop

[GitHub #24](https://github.com/Kminkjan/infrastructurio/issues/24)

Deliver and validate an open-ended growing region where detailed interventions matter.

#### G1 — Grow distinct land uses from experienced accessibility

[GitHub #35](https://github.com/Kminkjan/infrastructurio/issues/35)

Make road outcomes change where homes, commerce and industry develop.

Depends on: T3.

Acceptance criteria:

- Competing candidate sites evaluate worker, customer and goods access from T3 measured costs with regional demand bounds.
- Construction and decline use slower explicit intervals and smoothing; explain strongest support/constraint for selected and rejected sites.
- Completed development updates T1 trip generation, closing the feedback loop; removing access causes gradual consequences.
- Seeded tests cover a changed location decision after sustained travel-time change and no relocation from a single transient queue.

#### G2 — Let towns extend local streets within player constraints

[GitHub #36](https://github.com/Kminkjan/infrastructurio/issues/36)

Allow autonomous development to establish access while respecting player design authority.

Depends on: G1, R2.

Acceptance criteria:

- Town street proposals connect to valid topology and obey reserved corridors, elevation, ownership and a bounded local expansion rule.
- The player can reserve corridors and redesign/remove town streets; a persistence rule prevents immediate undoing of player decisions.
- New buildings require actual accessible entrances; rejected street development exposes its reason.
- Tests cover protected land, invalid connections, player redesign and deterministic town expansion.

#### G3 — Provide forgiving infrastructure finances and land tradeoffs

[GitHub #37](https://github.com/Kminkjan/infrastructurio/issues/37)

Make design choices consequential without transport-company management or routine financial failure.

Depends on: R2.

Acceptance criteria:

- Preview and charge construction, land and maintenance costs consistently for roads, junctions and elevation.
- Specify regional funding independent of player-owned freight revenue; provide a transparent recovery mechanism without escalating unavoidable debt.
- Calibrate the small-region budget so two viable junction solutions have different land/cost consequences and early mistakes remain recoverable.
- Test quote/commit consistency, rejected unaffordable edits and recovery; document tuning assumptions.

#### G4 — Save and replay causal road traffic and growing towns

[GitHub #38](https://github.com/Kminkjan/infrastructurio/issues/38)

Preserve the new world state and support reproducible design comparisons.

Depends on: G1, G2, G3.

Acceptance criteria:

- Version saves for authored geometry, movements, dynamic vehicles/occupancy, demand, measurements, growth, towns, finances and random state.
- Implement the F3 legacy-save policy with explicit validation and no silent partial load or discarded user data.
- A save during a queue resumes to the same deliveries, development and finances as uninterrupted simulation.
- Pause/speed changes preserve physical rules and deterministic outcomes; renderer interpolation does not become authority.

#### G5 — Validate the open-ended road design and growth prototype

[GitHub #39](https://github.com/Kminkjan/infrastructurio/issues/39)

Prove the integrated loop is understandable and sustained through actual design decisions.

Depends on: G4.

Acceptance criteria:

- Provide a small region with a few settlements/industries, space to develop, no forced ending and no scripted growth or bottleneck trigger.
- Record design → improved access → development → additional trips → physical queue → redesign, including two viable interventions with different consequences.
- Compare equal-lane-count junction designs using T3 metrics and explanations; repeat with fixed seeds and saved state.
- Run a first-time-player session without developer coaching; capture construction, bottleneck and growth comprehension findings and follow-up issues.
- Meet M4 measured scene/performance budgets or document a scoped corrective issue before closing M5; publish a reproducible validation report.

## M6 — Autonomous Rail Shapes the Region

[GitHub milestone](https://github.com/Kminkjan/infrastructurio/milestone/7)

Prove that tracks, switches, stations and signals attract autonomous passenger/freight train services whose physical operation affects road demand and regional growth. No player fleets, line plans or dispatch.

### E5 — Epic: Let autonomous rail services reshape the region

[GitHub #25](https://github.com/Kminkjan/infrastructurio/issues/25)

Extend infrastructure-only play to physically operating passenger and freight trains.

#### L1 — Build editable tracks, switches, platforms and station access

[GitHub #40](https://github.com/Kminkjan/infrastructurio/issues/40)

Extend precise infrastructure construction to a bounded railway network.

Depends on: G5.

Acceptance criteria:

- Draw/edit connected curved tracks, switches, passenger platforms and freight terminals with useful defaults and geometry validation.
- Model station/terminal road access and entrances; proximity alone does not establish passenger or goods access.
- Show routable platform/track connections and invalid layouts; maintain correct separation at elevated road/rail crossings.
- Tests cover switches, unreachable platforms, removal and station access; no fleet or line-management controls are introduced.

#### L2 — Simulate block signals, train occupancy and station conflicts

[GitHub #41](https://github.com/Kminkjan/infrastructurio/issues/41)

Make railway layout constrain actual service operation.

Depends on: L1.

Acceptance criteria:

- Provide basic player-placeable block signals with useful defaults and simulation-owned block/platform reservation and occupancy.
- Trains respect signal aspects, consist length and conflicting routes without overlap; invalid or deadlocked layouts are inspectable.
- A passing track or station-throat alternative changes waiting/throughput in a deterministic fixture.
- Network edits safely handle active trains and release reservations without losing goods or passengers.

#### L3 — Establish and dispatch fully autonomous train services

[GitHub #42](https://github.com/Kminkjan/infrastructurio/issues/42)

Reward usable infrastructure with operator-initiated service.

Depends on: L2.

Acceptance criteria:

- Bounded operator rules evaluate reachable demand, journey cost and capacity, then choose route, frequency and train size and dispatch through L2.
- Explain why a service starts, changes, withdraws or never starts, with explicit reevaluation cadence and hysteresis.
- At least one passenger and one freight service arise without player-created lines, timetables, purchased vehicles or dispatch commands.
- Tests cover viable startup, insufficient demand, disconnected access, infrastructure improvements and stable decisions under temporary congestion.

#### L4 — Feed autonomous rail use into road demand and development

[GitHub #43](https://github.com/Kminkjan/infrastructurio/issues/43)

Make rail compete and connect with the same growing world.

Depends on: L3.

Acceptance criteria:

- Mode choice includes station access/egress, waiting, journey time, reliability and freight transfer costs using actual service availability.
- Passenger and goods accounting prevents double counting across modes; transfers and waiting consume time.
- Observed rail outcomes alter accessibility and land-use choices, which change road and rail demand.
- Tests show that a rail improvement changes modal demand and a development outcome while an unserved station provides no fictitious benefit.

#### L5 — Validate and persist the autonomous rail growth loop

[GitHub #44](https://github.com/Kminkjan/infrastructurio/issues/44)

Demonstrate the infrastructure-only rail promise and preserve the road proof.

Depends on: L4.

Acceptance criteria:

- Version and round-trip service decisions, trains, reservations, transfers and operator state; resume a conflict with deterministic outcomes.
- Validate passenger and freight service startup, an inspectably unused station and improved service after an infrastructure-only intervention.
- Publish road-demand and development consequences plus small-region performance measurements against the M4 budget.
- Repeat the M5 regression scenario and a first-time-player rail inspection session; record failures as follow-up issues rather than claiming completion.
