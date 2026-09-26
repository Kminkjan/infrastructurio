# 0013 — Rendering and art pipeline

- Status: Proposed
- Date: 2026-09-26
- Scope: Prototype (M4). Affects `src/render` (`art/`, `core/`, `terrain/`, `track/`,
  `scenery/`, `trains/`, `overlays/`), the HUD's colours in `src/ui`, the asset contract
  and bundle loading. Builds on [ADR 0009](0009-render-isometric-threejs.md) (renderer,
  camera, coordinates, render on demand), which this ADR does not reopen
- Tracking: M4 epic "M4 — Epic: Living Diorama"
  ([#62](https://github.com/Kminkjan/infrastructurio/issues/62)); D11 art direction (a:
  lookdev spike → Look Gate A; b: final pass;
  [#75](https://github.com/Kminkjan/infrastructurio/issues/75)), with track meshes in D3
  ([#67](https://github.com/Kminkjan/infrastructurio/issues/67)) and structures in D4
  ([#68](https://github.com/Kminkjan/infrastructurio/issues/68)); see
  [the backlog](../backlog.md)
- Evidence: design only, consolidated from the owner-approved rail-first plan
  (2026-09-26) into [art direction](../art-direction.md) and
  [the architecture](../architecture.md). The reset skeleton has a starter
  [`palette.ts`](../../src/render/art/palette.ts) and a smoke scene in
  [`src/app/main.ts`](../../src/app/main.ts). No look has been judged and nothing has been
  measured
- Decision authority: Pending (proposed 2026-09-26)
- Supersedes: None
- Superseded by: None

## Context

ADR 0009 (Accepted) fixes the frame: `THREE.WebGLRenderer`, a fixed isometric orthographic
camera, the sim → three coordinate convention, render on demand, and React outside the
frame loop. It leaves open what the world is made of and how it is lit.

Constraints:
- **Look.** The M4 done-bar includes the owner's judgement that the diorama looks and feels
  right: Look Gate A at D11a and Look Gate B in the owner walkthrough.
- **Performance** (gate B, provisional until the owner approves it): on an Apple M5 Pro at
  High and DPR 2, frame p95 ≤ 16.7 ms, ≤ 150 draw calls at Default zoom (≤ 250 at Far),
  rebuild after a 10-piece edit ≤ 3 ms, initial JS ≤ 350 KB gzip. A mid laptop at Medium is
  measured or recorded "deferred, not passed"
  ([acceptance gates](../evidence/m4/2026-09-26-acceptance-gates.md)).
- **Scale** of the `bench-m4` scene: about 900 pieces, 15k trees, 150 buildings, 24 trains.
- **Means.** The repo has no art assets, authoring tools or asset pipeline today, and art is
  a known time-sink risk.
- **Originality.** The mood reference, Mighty Tiny Railways, is close in genre, so
  originality has to be designed in rather than checked at the end.

## Decision

**1. Procedural first, behind an `AssetRegistry` slot contract.**
- All M4 art is generated in code: terrain from sim heights, track along analytic arcs,
  structures, trees, a building grammar, props, vehicles and steam.
- Every drawable kind resolves through `AssetRegistry.get(kind, variant, lod)`. It returns
  geometry per material slot, named anchors (`smoke`, `bogie_front`, `bogie_rear`,
  `coupler`, `door`), a footprint and a triangle budget: ≤ 600 per building, ≤ 1,500 for a
  hero building, trees at 2 LODs.
- Model space is +Y up, metres, origin at ground contact, forward +X. A generator test
  checks winding against normals (`FrontSide` only, per ADR 0009).
- **glTF path, later:** Blender exports in the same convention, with named material slots
  and empties for anchors, loaded by `GLTFLoader` with meshopt (no Draco), and registered
  against the same keys. The procedural generators stay as the fallback.

**2. One palette module.**
- `src/render/art/palette.ts` is the only colour source for the renderer and the HUD. The
  HUD takes its colours from the same module, as CSS custom properties set at startup.
- The skeleton holds a starter subset. D11a grows it to the full table in
  [art direction](../art-direction.md) (grass `#8FA66B`, spruce `#3F5A3C`, stucco
  `#E9DFC8`, tile roof `#C0643F`, ballast `#8C8578`, haze `#DCDCCB`, parchment `#F3EDE0`,
  …), including the build-state, block-overlay and colour-blind-safe sets.
- Values are sRGB hex. Vertex and instance colours go through `THREE.Color`, which converts
  them to the linear working space; raw hex bytes are never written into attributes.

**3. Lambert plus vertex colours.**
- `MeshLambertMaterial` with vertex and instance colours, about 12 materials in total.
  Flat shading for trees, roofs and rocks; smooth terrain.
- Shader tweaks are isolated `onBeforeCompile` chunks, each with its own
  `customProgramCacheKey`: grain (world-space noise, ±6% luminance), lattice, windSway,
  foliageTint and edgeFade.
- Scale stylisation: rails 1.5× thicker, trees about 15% oversize.

**4. The lighting recipe.**
- `SRGBColorSpace` output, `NeutralToneMapping`, exposure 1.0.
- `HemisphereLight(#D6E4EC, #6B6A4E, 1.1)`.
- `DirectionalLight(#FFE8C2, 2.4)` at 42° elevation, locked to camera yaw so the sun always
  comes from the upper left. Shadow intensity 0.72, bias −0.0004, normalBias 0.03.
- Baked vertex AO plus a world AO tint map, and a CSS vignette. Tilt-shift is optional,
  High only, and off while a construction tool is active.

**5. One fitted, texel-snapped shadow map.**
- A single directional shadow map. Its orthographic shadow camera is refitted on camera
  change to the view footprint (the visible Y = 0 ground quad plus a height margin), and
  its origin is snapped to whole shadow texels in light space so shadows do not shimmer
  while panning. No cascaded shadow maps.
- Reason: an orthographic camera at a fixed pitch has no perspective depth range to split.
  A map fitted to the footprint keeps a roughly constant texel-to-pixel ratio at every
  zoom, which is the problem cascades solve for perspective cameras. This is inference, to
  be confirmed at Look Gate A.
- `PCFShadowMap` with radius and intensity (`PCFSoftShadowMap` is deprecated in r185).

**6. The base look works without post-processing.** Look Gate A judges Medium, which has
no post pass (a CSS vignette only). High adds a lazily loaded `EffectComposer` chain: MSAA
target → half-res GTAO → grade pass → optional tilt-shift → `OutputPass`. Post never
carries the look, and it stays out of the initial bundle.

**7. Quality presets.**

| Preset | DPR | Shadows | Post |
| --- | --- | --- | --- |
| Low | 1 | none (baked AO only) | none |
| Medium (default) | ≤ 1.5 | 2048 PCF, radius 2 | none; default MSAA, CSS vignette |
| High | ≤ 2 | 4096 PCF, radius 3 | the lazy composer chain in decision 6 |

- Dynamic resolution scale 0.7–1. The auto-preset drops one level if frame p90 exceeds
  20 ms over the first 3 s.
- Ambient animation (sway, windmill sails) runs at 30 fps and is off under reduced motion
  or power saver.
- Bench runs pin the preset, disable auto-drop and dynamic resolution, and record that, so
  gate B measures the preset it names.

**8. Track as `BatchedMesh`, with a fallback.**
- Three `BatchedMesh`es (ballast, sleepers, rails), one geometry range per piece, added and
  removed by network revision diff, so a 10-piece edit rebuilds only those ranges. Turnout
  timbers join the sleeper batch; blades animate from `switchLeg`.
- Geometry follows the analytic arcs in the `NetworkView` render prims, sampled at
  Δθ = min(2·acos(1 − 0.02/r), 5°), a chord error ≤ 2 cm.
  - Ballast trapezoid (−2.2, −0.35) (−1.6, 0) (1.6, 0) (2.2, −0.35).
  - Sleepers 2.6 × 0.14 × 0.24 m every 0.9 m.
  - Rails 0.11 × 0.16 m at ±0.817 m, a purely visual 1.524 m gauge.
  - Far LOD (< 4 ppm) hides sleepers and shows a ballast stripe.
- Everything sits behind a `TrackBatch` interface. Without `WEBGL_multi_draw`, a
  chunk-merged backend replaces `BatchedMesh`, because the three.js fallback issues one
  draw per range and would break the draw-call budget.

**9. Originality rules.**
- Mighty Tiny Railways is a **mood reference only**. Its assets, screenshots, names, UI
  layouts and colours sampled from its captures never enter the repo. Art direction links
  its Steam page for the mood board.
- Forms and palette come from public-domain sources around 1900: Library of Congress
  Photochrom prints of Riga, Vilnius and villages (1890–1905), Levitan and Čiurlionis
  landscapes, and period railway photographs.
- Station names come from the project's own Baltic list. Place names use a self-hosted
  OFL serif (an EB Garamond woff2 subset, with its licence committed); UI numerals use
  system-ui or Inter.
- Every non-procedural asset records its source and licence next to it.
- Originality is a scored item in the Look Gate A rubric (palette, charm, legibility,
  cohesion, originality).

Open: final palette values after Look Gate A; the 35.264° vs 30° pitch A/B (ADR 0009's
single constant); which glTF assets, if any, arrive before M5. WebGPU is out of M4 (ADR
0009).

## Alternatives considered

- **Hand-made glTF first.** It could look richer per object. Rejected for M4: no authoring
  pipeline or asset author exists, every look iteration would round-trip through Blender,
  and Look Gate A needs live parameter tweaks (the D11a tweak panel). The slot contract
  keeps glTF open for hero pieces later without changing callers.
- **Toon shading.** Stepped lighting and outlines read as cartoon, against the muted,
  painterly Baltic mood, and outline passes add post cost that the base look must not need.
  `MeshStandardMaterial` was rejected too: it needs an environment map to read well.
- **Textures.** Painted or PBR textures add authoring time, memory and download size, need
  UVs from every generator, and fight the flat-colour look. The grain chunk gives surface
  variation without them. Data textures (the terrain splat map and the AO tint map) are
  allowed; painted textures are not.

## Consequences

- **Benefits:** one palette and about 12 materials keep draw calls and shader programs few.
  Generators are testable (winding, triangle budgets, anchors) and stable per seed. The
  look can be tuned live, and originality is handled by construction.
- **Costs:** procedural generators are code to maintain. Lambert has no specular, so rails
  and water rely on palette contrast rather than highlights. The texel-snapped fit and the
  preset matrix need checking at every zoom band and all 6 yaws.
- **Risks:**
  - art becomes a time sink (mitigation: Look Gate A early, D11b time-boxed);
  - procedural forms look generic (the rubric catches it);
  - one shadow map is too coarse at Far zoom (fallback: fade shadows below a ppm band, a
    D11b decision, not a cascade).
- **Compatibility:** the `AssetRegistry` keys and anchors are the contract that glTF assets
  must meet. Renaming a key breaks both paths.
- **Follow-up:** a boundary scan that flags colour hex literals outside `palette.ts`
  (D11a); `AssetRegistry` and generator tests (R3); `TrackBatch` with both backends (R2,
  D3); presets, auto-drop, dynamic resolution and context-loss recovery (D11b); preset
  pinning in the Playwright bench (D12).

## Validation and acceptance boundaries

- **Agent code reading, 2026-09-26:** the skeleton smoke scene
  ([`src/app/main.ts`](../../src/app/main.ts)) uses Lambert, the hemisphere-plus-sun recipe,
  `NeutralToneMapping` and palette colours, with the sun at 42° elevation (a normalisation
  bug that put it at ~51.7° was fixed in `ac1e6a7`). The build passes, so the recipe
  compiles, and an agent browser check of PR #60 saw the smoke scene render. It is not a
  look verdict and not evidence for any gate.
- **Owner only:** Look Gate A (D11a: four bookmark views beside the mood board, rubric 1–5
  including originality) and Look Gate B (the walkthrough). Agents never perform, simulate
  or narrate them.
- **Automated and agent:** gate B draw calls, frame p95, rebuild time, leaks over 200
  edit/undo cycles and initial JS on the named hardware; the mid laptop measured or
  recorded "deferred, not passed".
- Accepting this ADR is not passing any look or performance gate.

## Revisit when

- Look Gate A scores low on mood, cohesion or originality in a way parameters cannot fix
  (→ glTF hero pieces or data-texture detail);
- gate B misses draw calls or frame time at Default zoom;
- `BatchedMesh` or its fallback misbehaves on the mid laptop;
- shadow quality at Far or Region zoom fails the owner's readability check;
- WebGPU becomes the renderer (an ADR 0009 revisit), which changes the material and post
  path;
- M5 needs building kinds or vehicle variety beyond the grammar.

## History

- 2026-09-26: Proposed in the rail-first reset PR that adds ADRs 0009–0014 ([#61](https://github.com/Kminkjan/infrastructurio/pull/61)); owner decision pending.
