# M3 Release Validation

This document is the reproducible release-gate script for issue #19. It covers
the complete Millford Valley arc, all three intended strategic interventions,
late-scenario persistence, the target-scale fixture, and the browser smoke.

## Automated release gate

Run the release-specific behavioral checks with:

```sh
npx vitest run src/testing/m3-release-gate.test.ts
```

The fixture uses the deterministic `millford-valley-foundation` seed with a
variant suffix. Every variant performs the same shared setup: inspect the three
supply-chain sites, build quarry–stoneworks and Eastbank–market arterials, and
advance one day until the old bridge overload is authoritative. It then applies
one intervention and advances daily boundaries until the three-day stability
hold completes.

The checked outcomes are:

| Variant | Ending day | Scripted actions | Capital spending | Daily maintenance | Modal split | Ending balance |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| Crossing upgrade | 16 | 22 | $21,078.79 | $174.84 | 200 road / 0 rail t/day | $76,199.06 |
| Highway bypass | 16 | 22 | $36,791.61 | $267.49 | 200 road / 0 rail t/day | $59,097.05 |
| Rail shift | 16 | 24 | $44,538.74 | $307.98 | 100 road / 100 rail t/day | $50,741.48 |

No variant uses an emergency bond. The outcomes are deliberately distinct:
the upgrade is cheapest and retains bridge traffic, the bypass buys a separate
road route with higher construction and maintenance cost, and rail costs most
up front while moving outbound freight off the road network. Capacity is
therefore not a free or uniquely dominant maximum-capacity choice.

The same test serializes each variant after its first successful stability day,
restores it through the portable save validator, and proves equality of the
authoritative economy, operators, road and rail networks, finances, development,
objectives, and continued ending. Accessibility cache-invalidation history is
derived afresh after restore and is intentionally not persisted; its values and
all state that affects future outcomes remain equal.

## Timed manual playtest

Use a clean browser profile or choose **Reset** before each run. Start a timer
when the initial objective is visible. Do not use a prior save or an emergency
bond.

### Shared arc, minutes 0–19

1. Inspect Granite Ridge Quarry, Millford Stoneworks, and the Eastern External
   Market. Read each blocked-leg explanation before building.
2. Choose **Build arterial** and connect the quarry to the stoneworks.
3. Build a second arterial from Eastbank to the external market. The authored
   approaches and old bridge complete the outbound route.
4. Advance one day. Confirm raw granite and finished stone move, the bridge is
   marked as overloaded, and its inspector names demand, capacity, delay, and
   affected freight.
5. Before intervening, state what the next traffic, daily economy/finance, and
   weekly development updates are expected to do. Compare that statement with
   the bounded consequence forecast.

If a route does not activate, use its inspector rather than undocumented setup:
the missing endpoint or disconnected link is named by the authoritative
limiting factor. Reset is always available and does not retain bond penalties.

### Choose one intervention, minutes 19–24

- **Crossing upgrade:** select the overloaded old crossing road and choose
  **Upgrade this crossing**.
- **Highway bypass:** choose **Build highway** and draw a direct connected route
  from Millford Stoneworks to the external market. Confirm the route crosses
  constrained river work and Eastbank land in the construction quote.
- **Rail shift:** place the Stoneworks and Market freight terminals, choose
  **Build track**, and connect the two sites directly.

Confirm the operator explanation shows why the chosen route or mode wins. The
bridge must either be at or below capacity or no longer carry the affected
outbound freight.

### Stabilize and reflect, minutes 24–30

1. Advance two weeks, then one day. The ending should occur on simulated day 16.
2. Confirm both freight legs remain served, completed regional growth is
   visible, finances cover the next daily burden, and the stability counter
   reaches three days.
3. Read the ending comparison: intervention, capital spending, maintenance,
   modal split, bridge condition, and both settlements' accessibility changes.
4. Record elapsed real time, any step that required help, and whether the player
   can answer the six questions in the explanation contract. A run outside
   20–30 minutes or a question that cannot be answered is a finding, not a pass.

## Target-scale fixture and browser smoke

[`fixtures/m3-target-scale-save.json`](../fixtures/m3-target-scale-save.json)
is a portable version-9 save containing the densest expected M3 state:

- 12 authored road segments and 14 road links;
- 6 rail tracks, 6 rail links, and all 3 freight terminals;
- both active 100-ton/day supply-chain legs;
- 7 completed or pending development marks;
- 2 active route-overlay features; and
- 10 representative freight vehicles.

Run `npm run dev`, import the fixture, and perform this browser smoke:

1. Confirm the header reports day 52, 12 roads, 6 tracks, 3 terminals, 60
   regional growth, and 100 t/day stone exports.
2. Confirm two rail movements and their overlay descriptions are present.
3. Use zoom in, zoom out, and **Fit**; the map remains interactive.
4. Choose **Save local**, **Load local**, and advance eight hours. Counts,
   finances, ending, routes, and representative traffic remain present.
5. Confirm there are no browser console errors.

Development builds expose one bounded 180-frame sample on the world canvas after
each snapshot update. Read it in browser developer tools with:

```js
JSON.parse(document.querySelector("canvas").dataset.framePerformance)
```

The sampler is guarded by Vite's development flag and is removed from the
production build.

## M3 claim evaluation

The release evidence supports the M3 claim at the intended prototype scale:
all three intervention paths reach a clear ending, use different authoritative
tradeoffs, survive late persistence, replay deterministically, and render
smoothly at the densest fixture on the reference environment. The player-facing
objective, inspector, cadence, forecast, overlay, and ending surfaces cover the
explanation contract without undocumented setup.

This is not evidence for larger maps, additional supply chains, equilibrium
traffic, passenger operations, or broad hardware classes. First-time-player
comprehension across an external participant sample remains follow-up validation
in [issue #20](https://github.com/Kminkjan/infrastructurio/issues/20); the release
gate provides the exact script and pass/fail questions needed for it.
