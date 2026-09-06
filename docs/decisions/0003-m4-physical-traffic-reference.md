# 0003 — Retain individual physical vehicles as the M4 reference

- Status: Accepted for the bounded research reference; production traffic design remains open
- Date: 2026-09-06
- Evidence: [M4 lane study](../research/m4/README.md), [raw measurements](../research/m4/lane-results.json)
- Tracking: #27; does not resolve #26 or #28

## Decision

Keep one physical vehicle per simulated trip in the reference fixture. Reject
spatial-platoon batching with weights 2 and 4 as a drop-in optimization. Both
conserve represented trips but fail the predeclared outcome-error bounds at low
and saturated demand. Conflict service capacity must emerge from occupied space
and movement permissions; it cannot be obtained by multiplying decorative icons.

Retain simulation-owned occupancy and request-to-completion timestamps, with
pending demand explicitly accounted for. Distinguish physical occupancy, represented
trip counts and any later goods payload. Keep fixed movement steps when batching
for acceleration. Missing journey samples remain absent, not zero delay.

The current 0.5 s / 7.5 m cell model is only a falsifiable reference. It is not a
production car-following model or approval to integrate this fixture into M5.
Further representation schemes need new comparisons against weight 1, including
mixed demand, multi-junction spillback and outcome sensitivity.

## Consequences and limitations

At roughly 2,000 active vehicles and 128 directional lanes, the disconnected
movement benchmark fits a provisional p95 1 ms/tick and 2 ms/10-tick-batch envelope
on the named Apple M5 Pro. Keep the next experiment on the main thread. Revisit
workers after measuring a connected region plus routing, snapshots, UI and
rendering. No frame-rate or renderer decision follows from a Node benchmark.

The fixture has constant speed, coarse following space, an exclusive conflict
box, fixed demand and potentially starving priority. It does not establish
acceleration, lane changes, signal logic, realistic saturation flow, road editing,
rail operation or slower development. M5 and M6 retain their existing gates.
