# Simulation Model

This document describes the intended conceptual model. Equations, thresholds, and implementation details are expected to change through prototyping.

## Simulation layers

### Regional demand

The region has bounded demand for population, employment, production, and trade. Demand changes through migration, economic cycles, external markets, and scenario events.

Infrastructure does not create unlimited population. It determines which opportunities are viable and where regional growth is captured.

### Accessibility

Locations are evaluated through generalized access costs rather than straight-line distance. Relevant measures include:

- Reachable workers and jobs
- Travel time to consumers and services
- Cost and reliability of reaching suppliers and resources
- Cost of reaching external markets
- Available infrastructure capacity
- Interchange and terminal penalties

Accessibility is recalculated incrementally when the network or persistent congestion changes.

### M1 accessibility research prototype

The first accessibility experiment evaluates the existing Millford and Eastbank
settlement seeds as candidate locations. It reports separate market, labor,
resource, and service values. Every opportunity contribution decays with shortest
road-network cost; straight-line distance is not a scoring fallback, and an
unreachable opportunity contributes zero. Each factor also retains its nearest
reachable network cost and number of reachable opportunities for inspection.

These values are derived simulation state. They are rebuilt from scenario and
road state after load rather than added to the save format. The initial
opportunity weights are explicit research assumptions rather than economic
quantities, and the values do not yet cause development. The experiment and its
limitations are recorded in
[`research/accessibility-scoring.md`](research/accessibility-scoring.md).

### Location choice

Households, developers, and industries compare candidate locations. A conceptual score is:

```text
opportunity
+ market access
+ labor access
+ local amenities
- transport cost
- land cost
- congestion
- pollution and risk
```

Scores produce weighted choices rather than always selecting the mathematical maximum. Inertia, moving costs, construction time, and imperfect information prevent instant reshuffling.

### M1 settlement growth prototype

The first growth implementation treats Millford and Eastbank as competing
residential development candidates. Their existing settlement seeds represent
base populations of 60 and 40 residents. Infrastructure-enabled growth is a
separate authoritative value so decline never erases that original settlement.

Every seven simulated days, positive development pressure becomes a weighted
location-choice input:

```text
pressure = 0.35 * market access
         + 0.30 * labor access
         + 0.20 * resource access
         + 0.15 * service access
         - 35 land and viability cost points
```

A deterministic value derived from the scenario seed and evaluation number
selects among all candidates with positive pressure. A stronger candidate is
more likely to win, but does not receive every project automatically. One
selected project houses up to 10 residents and takes seven simulated days to
complete. Completed and pending projects together may never exceed the scenario's
100-resident regional growth demand.

Network edits update pressure immediately. If a location loses viability, its
pending project is cancelled while completed growth remains in place. Later
weekly evaluations reduce only that infrastructure-enabled growth by five
residents at a time. This is an intentionally small pressure-and-decline model;
it has no households, land market, building types, relocation destinations, or
industry-specific resource requirements yet. The accessibility inputs also
retain the proxy weights documented in the research note. Detailed decision
explanations expose these limitations rather than presenting the proxy values as
real people, jobs, prices, or minutes.

### M1 development decision explanations

Each candidate's development snapshot carries the exact factor scores, weights,
and contributions used to calculate its current pressure. It also carries its
share of total positive pressure and the selected candidate associated with the
latest pending weekly project. This makes a losing candidate inspectable even
when a seeded choice awards development to a lower-probability alternative.

Market, labor, resource, and service access remain positive decision inputs in
prototype access points. The transport explanation reports shortest-road market
cost in generalized hours and compares it with the best routed alternative.
That transport cost is already embedded in the exponentially decayed access
score, so it is not subtracted again. The previous undifferentiated 35-point
viability threshold is now named as an equal land-and-viability cost for both
Millford and Eastbank. It is the model's explicit negative contribution, but it
is still a balancing assumption: there is no simulated land supply, rent, or
parcel market yet.

Decision explanations are current derived state, not an event history. A network
edit immediately updates their access evidence and may cancel a pending project;
the prototype does not retain explanations for earlier allocations after their
inputs change.

## Settlements and buildings

A settlement is an emergent cluster, not an object placed by the player. It gains an identity when development density and shared access patterns cross a threshold.

Economic calculations may occur at parcel-cluster or district level. Individual buildings represent those aggregate values visually and provide inspectable history.

Building actions include:

- Construct
- Expand
- Change use
- Decline
- Demolish and redevelop

## Industries and goods

Industries transform inputs into outputs and require labor, land, infrastructure, and market access. Prototype supply chains should remain short enough to diagnose.

Example:

```text
quarry -> stone processing -> regional construction demand
farm -> food processing -> households and external market
```

Production and shipment decisions can be aggregated by day. Visible trucks and trains represent portions of those flows rather than every physical consignment.

## Traffic and route choice

Travel demand is generated between zones or economic actors. Routes minimize generalized cost, including:

- Free-flow travel time
- Congestion delay
- Tolls and operating cost
- Transfer penalties
- Reliability penalties
- Mode restrictions

Traffic assignment may update less frequently than rendered vehicle motion. Representative vehicles are sampled from assigned flows.

### M0 road topology

The authoritative road network distinguishes player-authored segments from the
graph links derived from them. Segment endpoints and at-grade intersections form
nodes; intersections split every affected segment into routable links. M2 route
queries now minimize generalized hours derived from road-class free-flow time and
the most recent congestion assignment. Geometric length remains available for
rendering and construction information.

Deleting a player-authored segment removes all links derived from it and rebuilds
the remaining topology. The M0 graph intentionally does not model collinear
overlaps, grade-separated crossings, curved roads, or configurable junctions.

### M3 Millford stone supply chain

The original quarry export toy is now a two-leg aggregate supply chain:

```text
Granite Ridge Quarry -> Millford Stoneworks -> Eastern External Market
```

The quarry offers at most 120 tons of raw granite per day. The stoneworks has a
240-ton input store, processes at most 100 tons per day at a one-to-one prototype
conversion, and has a 160-ton finished-stone store. The market requests at most
100 tons of finished stone per day. These are explicit vertical-slice balancing
values rather than real-world production claims.

The economy advances at fixed daily boundaries in stable order: inbound granite
is delivered, available input is processed subject to processing and output-store
capacity, then finished stone is shipped from inventory. A large advance processes
every crossed daily boundary. This order is intentionally simple and means a full
output store can constrain that day's processing before outbound sales free space.
No persistent shipment or per-vehicle inventory exists.

The M2 cost model supersedes the original geometric freight cost. A route at or
below 16 generalized hours can carry all otherwise available freight. Between 16
and 32 hours, shipped volume declines linearly; at 32 hours the route becomes
unviable. These explicit scenario values remain balancing inputs. The freight
snapshot records the assigned route and the same production, demand, generalized
cost, and limiting-factor values shown by the inspector. The two freight legs and
the stoneworks separately expose route, production or storage, input shortage,
processing capacity, finished inventory, and market-demand constraints from the
same values used by the reducer.

Realized processing creates up to 40 labor-opportunity weight at the stoneworks,
scaled linearly from zero to full processing. That opportunity is routed through
the existing accessibility scorer and therefore affects settlement pressure only
where the stoneworks is reachable. Residential development still evaluates on
its weekly cadence, so the response remains delayed.

### M2 road capacity and congestion

Every authored segment has a road class, which is copied to its derived links.
The prototype profiles are:

| Class | Free-flow speed | Practical capacity |
| --- | ---: | ---: |
| Local | 35 map units/hour | 40 assigned flow units/day |
| Arterial | 60 map units/hour | 80 assigned flow units/day |
| Highway | 90 map units/hour | 160 assigned flow units/day |

The construction tool can build arterials or highways. An overloaded authored
segment can be upgraded to highway class; because links are derived rather than
independently editable, that command upgrades the complete authored segment.

For a link with free-flow time `t0`, assigned flow `v`, and practical capacity
`c`, delay is zero while `v <= c`. Above capacity, the prototype curve is:

```text
delay = t0 * 0.5 * ((v / c)^4 - 1)
generalized cost = t0 + delay
```

The deliberately steep curve makes a toy-scale overloaded crossing capable of
changing a route decision. Each active supply-chain leg contributes one assigned
flow unit per shipped ton per day. Assignment runs immediately after a network
edit and then every eight simulated hours. Each leg chooses one minimum-cost route
using the previous assignment's persistent costs; link demand is the sum of every
leg using it. Accessibility is recalculated from those same costs, so congestion
can change the inputs used by weekly development decisions.

This is capacity-restraint scaffolding, not a traffic equilibrium. It has two
aggregate freight legs, does not split a leg across routes, and does not yet generate
commuter traffic from development. With competing routes, all-or-nothing demand
can shift again on later assignment boundaries. Queue length and spillback remain
out of scope.

### M2 bridge bottleneck diagnosis and interventions

The simulation derives a bottleneck analysis from the same assigned link flows,
capacities, delays, route, and assignment cadence used by transport and freight.
Each overloaded link reports assigned and excess demand, practical capacity and
volume/capacity ratio, congestion delay, current route cost, next assignment
tick, and affected aggregate flows. An overloaded link whose geometry intersects
the authored Millford Crossing constraint is identified as the Millford bridge.

The renderer turns that snapshot into an amber affected-route overlay and a red
overloaded-link overlay. React presents the diagnosis without recalculating its
causes. Two player interventions are available:

- Upgrade the authored crossing segment to highway class. This increases its
  speed and capacity while keeping assigned traffic on the corridor.
- Draw a connected highway bypass. If its persistent generalized cost beats the
  congested crossing, the next eight-hour assignment redirects freight; the new
  network costs also feed accessibility and later weekly development evaluation.

Induced demand, commuter flow, and multi-route equilibrium remain out of scope.
A long authored road that crosses the constraint is upgraded in full because the
graph does not store the geographic crossing as an independently editable
segment.

### M3 rail corridors and freight terminals

Rail is an authoritative graph independent of the road graph. Player-authored
straight track segments are rebuilt into nodes and links at endpoints, at-grade
track intersections, and placed terminal sites. Collinear overlapping track is
rejected, matching the prototype's deliberately simple geometry boundary.

Freight terminals may be placed only at Granite Ridge Quarry, Millford
Stoneworks, and the Eastern External Market. Each is anchored to its site rather
than freely positioned. A deterministic route query accepts two placed terminal
IDs, requires both sites to lie on the connected track graph, and minimizes
free-flow track time with stable ID tie-breaking. The returned route includes
the ordered node and link IDs, track distance and travel time, both terminal
transfer times, and the minimum track/terminal capacity. Removing required track
or either terminal makes the query return no route.

Prototype rail profiles are explicit vertical-slice balancing values:

| Infrastructure | Capacity | Free-flow rate | Base construction | Maintenance / day |
| --- | ---: | ---: | ---: | ---: |
| Track | 320 t/day | 100 map units/hour | $28/map unit | $0.14/map unit |
| Freight terminal | 240 t/day | 0.75 hours transfer | $5,000 | $35 |

Track inside Eastbank Fields adds $12 per intersected map unit. Each river
intersection adds $6,000 construction and $60 daily maintenance. Removing track
or a terminal credits 20% of base construction; land and river work are not
salvaged. Timetables, signals, passenger rail, and detailed junction or
grade-separated geometry remain outside this step.

### M3 private road and rail freight operators

Each aggregate supply-chain leg is assigned independently to one private road or
rail service. Assignment runs immediately after a relevant road, rail, terminal,
or service-price edit and every eight simulated hours. Candidates retain the
exact values used by the choice: generalized cost, practical capacity, free-flow
time, congestion delay, terminal handling, access/egress, and a non-negative
mode price adjustment. Stable ties use the mode ID; there is no random operator
behavior.

Road service uses the selected road route and its persistent congestion cost.
Rail service requires compatible terminals at both leg endpoints and connected
track. Because the M3 terminals are anchored at the quarry, stoneworks, and
market, rail access and egress are explicitly zero; the two 0.75-hour terminal
handling times remain part of generalized cost. Assigned road tons update road
link flow, delay, bottleneck analysis, and the road costs consumed by
accessibility. Assigned rail tons update track flow, delay, and terminal handling
load from the same assignment.

Choice is all-or-nothing per leg and does not split demand between modes. Rail
uses the same prototype over-capacity delay curve as roads, but current scenario
rail capacity exceeds either leg's maximum demand. The typed service-price
command represents a generalized-cost adjustment for testing repricing without
introducing toll zones, subsidies, or a full policy UI. Persistent vehicles,
fleets, schedules, individual companies, passenger demand, and competition
between same-mode operators remain out of scope.

### M3 infrastructure costs and treasury

The scenario starts with a $60,000 treasury. Every road quote is produced by the
simulation from normalized command geometry, then the same immutable breakdown
is used for the committed transaction. A breakdown separates base work,
Eastbank land acquisition, constrained river work, and salvage. The prototype
rates are explicit balancing values:

| Road class | Base construction / map unit | Eastbank land / intersected unit | Maintenance / map unit / day | River work / crossing | River maintenance / day |
| --- | ---: | ---: | ---: | ---: | ---: |
| Local | $6 | $4 | $0.03 | $1,500 | $15 |
| Arterial | $16 | $8 | $0.08 | $3,500 | $35 |
| Highway | $32 | $14 | $0.18 | $7,000 | $70 |

The Eastbank premium uses the length of the authored road centerline inside the
fertile-land polygon. River work is charged once for each intersection with the
authored river centerline. These are aggregate scenario proxies, not parcel
valuation or bridge engineering. A highway upgrade charges the positive
difference between the existing and highway base and river-work rates; it does
not reacquire land. Removing a road credits 20% of its current-class base work.
Land acquisition and river work have no salvage value.

Capital commands first build and validate a prospective network, then reject the
whole command when its authoritative quote exceeds the balance. No road,
identifier, traffic, accessibility, development, or finance state changes on
rejection. Removal credits salvage in the same transaction.

At each daily production boundary, finished-stone deliveries earn $25 per ton,
bounded to 100 tons and therefore $2,500 per day. Current road, track, terminal,
and river-crossing maintenance are then charged. Maintenance may take the treasury
below zero, preserving a recoverable state, but further unaffordable capital
commands remain blocked.

An emergency bond becomes available while the treasury is below $15,000. It adds
$15,000 immediately and creates a permanent $150 charge at every later daily
boundary. A later bond requires the treasury to fall below the threshold again,
and each bond stacks another $150 daily penalty. This keeps recovery available
without making repeated bonds free money. It is a deliberately small recovery
rule rather than a loan model: there is no interest schedule, repayment term,
tax system, inflation, or municipal budget.

### M3 representative freight traffic

Visible trucks and trains are presentation samples of assigned daily freight rates,
not authoritative shipments. The renderer resolves each freight snapshot's
ordered route nodes into a polyline and displays one representative vehicle per
20 shipped tons per day, rounded up for any positive flow. Trucks move at 90 map
units per real-time second and trains at 120.

Each sample is removed when it reaches its leg's destination and a later visual
trip starts at that leg's origin. A changed route or shipped volume replaces the current visual
sampling plan; a missing or unviable route clears it. These animation phases are
intentionally absent from simulation snapshots and saves.

## Private operators

Vehicles belong to simulated operators. Operators respond to demand, infrastructure compatibility, operating cost, capacity, and policy.

The player influences them through infrastructure and rules rather than dispatching individual vehicles. Later systems may include track access, service subsidies, weight limits, electrification, and minimum-service contracts.

## Autonomous local roads

The default autonomy boundary is:

- The simulation may build driveways, local streets, and small access junctions.
- The player builds arterials, highways, major crossings, railways, and terminals.
- Towns may propose collector roads or upgrades for player approval.

Local road generation must respect terrain, protected corridors, maximum road class, intersection rules, and development boundaries.

## Explanation model

Important simulation outcomes retain their strongest causes. An inspector should be able to explain, for example:

> Rail reduced export cost, nearby farmland supplies inputs, and 2,800 workers are reachable within 35 minutes. High land cost is the largest constraint.

Explanations should be derived from the same values used for decisions, not generated independently after the fact.

## Simulation time

Different systems use different clocks:

- Rendering: every animation frame
- Representative vehicles: several times per second
- Traffic assignment: every few simulated hours or after material network changes
- Production and inventories: daily
- Development evaluation: weekly
- Migration and land values: monthly
- Regional economy: quarterly
