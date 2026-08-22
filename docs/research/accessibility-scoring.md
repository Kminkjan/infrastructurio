# Generalized accessibility scoring prototype

- Issue: [#8 — Prototype generalized accessibility scoring](https://github.com/Kminkjan/infrastructurio/issues/8)
- Status: Implemented experiment
- Date: 2026-08-22

## Question

Can a small set of network-based access measures create plausible differences
between candidate development locations, while allowing local network edits to
avoid a region-wide recalculation?

## Prototype

Millford and Eastbank are the candidate locations because they are the two
deterministic settlement seeds already present in Millford Valley. Opportunities
use existing scenario features plus temporary proxy weights:

| Factor | Opportunities | Prototype weight |
| --- | --- | ---: |
| Market | Eastern external market | 100 |
| Labor | Millford, Eastbank | 60, 40 |
| Resource | Granite quarry, fertile land center | 55, 45 |
| Service | Millford, Eastbank | 70, 30 |

For each factor, reachable opportunity weights are summed after exponential
decay over shortest road-network cost:

```text
access = sum(opportunity weight * exp(-network cost / 500))
```

An opportunity with no road route contributes zero. The result also retains the
nearest network cost and reachable opportunity count so the score can be checked
without reconstructing it from map geometry. These weights and the 500-unit
decay are experiment inputs, not settled balance values.

Each cached location records a fingerprint of its reachable road component and
its cost to every opportunity. A topology change triggers cost probes only in
changed components; a location's score cache is invalidated only when at least
one of those costs changed. This catches new shortcuts, component joins, and
component splits without invalidating locations that cannot reach the edit or
whose relevant costs stayed the same.

## Findings

Useful behavior:

- Market access clearly rewards an actual route to the map-edge market and
  distinguishes direct from circuitous connections.
- Resource access differentiates the quarry side from the fertile-land side and
  can represent sites that reach multiple inputs.
- Labor access can express a larger reachable pool rather than only proximity to
  one settlement.
- Equal straight-line distances produce different values when their network
  routes differ, which makes player-built connectivity causally important.
- Component-scoped invalidation avoids rescoring candidates in disconnected,
  untouched parts of the map and remains deterministic across replay and load.

Behavior that was not yet useful or conclusive:

- Service access is strongly correlated with labor access because both currently
  use settlement seeds. It needs distinct service facilities or capacities to
  add much explanatory value.
- Proxy opportunity weights create plausible differences but are not grounded in
  simulated population, jobs, output, or service capacity. Permanent values
  should come from authoritative economic state.
- Combining quarry and fertile-land access into one resource number loses input
  specificity. Development rules will need required-resource types before this
  factor can determine industry suitability.
- A topology change still probes every candidate in the changed component before
  deciding which score caches to invalidate. Larger connected networks may need
  edit-region or dynamic shortest-path indexing to narrow that detection work.

## Decision

Keep market, labor, resource, and service as separate inspectable values and use
network cost as their shared foundation. Carry the scorer forward as derived
simulation state, but do not combine the factors into a development score until
regional demand and location competition are implemented. Revisit opportunity
weights, typed resource requirements, and service inputs with issues #9 and #10.

Issue #9 now combines the four factors only for a bounded residential settlement
growth prototype. The combination is an explicit balancing assumption, not a
finding that resolves the correlated service/labor inputs or the need for typed
industry resources. Issue #10 now exposes those separate weighted inputs, their
network-cost evidence, and their comparisons in the settlement inspector. It
also labels the equal 35-point land-and-viability cost as a prototype assumption;
the underlying balancing limitations remain.
