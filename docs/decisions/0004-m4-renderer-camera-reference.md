# 0004 — Keep Pixi plan view as the bounded editing reference

- Status: Accepted for further research only; production renderer/camera choice pending review and human comparison
- Date: 2026-09-06
- Tracking: #26; does not close #21, #26, #27 or #28
- Evidence: [paired browser experiment](../research/m4/rendering/README.md)

## Decision

Retain Pixi WebGL with the existing plan-camera coordinate system as the reference
for the next precision-editing evaluation. Keep the minimal Three.js orthographic
oblique/top alternative in the isolated experiment for comparison. Do not migrate
the production renderer on the strength of this study.

Use explicit layer filtering and a named keyboard target list in subsequent
inspection research: both views select the deck when clicking the obscured queue,
and both recover queue access through these shared controls. Keep authored
geometry and inspection state independent of either renderer.

## Evidence and tradeoffs

Both implementations execute the same scripted drawing, reshaping, turn selection
and deck-height edit. The 3D adapter provides a spatial elevation cue and a top
camera; 2D needs explicit elevation text/layer cues. Neither automatically resolves
occlusion. Automated inputs use known projected coordinates and cannot establish
which view people find precise, readable or discoverable.

Both fit the provisional measured rendering envelope on the named M5 Pro at DPR 1.
Three.js instancing and Pixi per-icon objects are different implementation strategies;
the CPU measurements do not establish an intrinsic engine advantage. No integrated
traffic, connected-region workload or lower-end GPU was measured. Reference
retention follows existing code reuse and insufficient migration evidence, not a
claim that 2D won a human usability comparison.

For the isolated 128-lane-strip / 2,144-icon workload, adopt provisional regression
guardrails of p95 <=20 ms browser frame interval, <=4 ms update/render-submit CPU,
and <=8 ms edit-rebuild CPU on this reference hardware. These are scoped research
budgets selected after measurement, not the final M5 region/frame budget. Keep
ADR 0003's disconnected movement measurements separate.

## Revisit before production acceptance

Review the paired screenshots, input observations and raw samples. Perform a human
comparison with tasks and errors recorded, including hidden queues and elevation
comprehension. Evaluate accessible drawing and camera control, denser junctions,
connected simulation/snapshots/UI and representative lower-end hardware. Then
accept or supersede this record with the production renderer/camera and region
budget. #28 cannot finalize migration from this provisional reference alone.
