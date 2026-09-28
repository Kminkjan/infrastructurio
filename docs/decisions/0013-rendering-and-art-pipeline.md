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

## Findings (2026-09-26, D11a lookdev spike)

Recorded while implementing D11a on branch `codex/d11a-lookdev`
([#75](https://github.com/Kminkjan/infrastructurio/issues/75)). Automated tests (Vitest in Node)
and an **agent** browser run (headless Chrome through Playwright on an Apple M5 Pro, ANGLE
Metal, 1280 × 720 at DPR 1). The status of this ADR stays **Proposed**, and nothing here is a
look verdict: Look Gate A is the owner's.
- **Decision 1 held, with the `coupler` anchor split into `coupler_f`/`coupler_r` and a
  `sail_hub` anchor and `sails` slot added.** [`AssetRegistry.get(kind, variant, lod)`](../../src/render/art/AssetRegistry.ts)
  returns geometry per material slot (`walls`, `roof`, `trim`, `glass`, `metal`, `foliage`,
  `sails`), anchors (`smoke`, `bogie_front`, `bogie_rear`, `coupler_f`, `coupler_r`, `door`,
  plus `sail_hub` for the windmill's pivot), a footprint and a triangle budget. Trees, the
  building grammar and props register procedural providers. A building lot's footprint and
  seed pack into one integer variant (`buildingVariant`), so a later glTF provider can read
  the footprint back.
- **Budgets met with room** (committed tests: 8 seeds per footprint; the ranges below come
  from a one-off agent probe over 200 seeds per footprint, not committed): trees 68/72/70
  triangles at LOD0 (spruce/pine/birch) and 26/24/28 at LOD1; townhouse 126–332, wooden
  house 163–173, warehouse 158–328, station 396, engine shed 252, water tower 125, post
  windmill 112, farmstead 182, and the hero church 528 (budget 1,500). Every generated triangle faces away
  from the inside of its part (tested), so `FrontSide` holds everywhere. Because the builder
  winds each triangle away from the inside point its caller gives, that test alone could not
  catch a wrong inside point; two oracles that never read it back it up: convex parts (box,
  prism, cone, blob) face away from their own vertex centroid, and every roof-slot triangle
  faces up except recorded bottom-cap soffits (the water tower's cone base).
- **Materials: six, not a dozen.** Materials are split by shader-chunk combination, never by
  slot or colour, as art direction asks: terrain, water, foliage, built (walls, roofs, trim,
  metal and sails share one combination), glass and props. Merging slots that share a
  material keeps a town to two draws per 256 m chunk. Track (D3), steam and vehicles bring the
  count toward the dozen this ADR estimates. Roofs, trees and props are flat-shaded; the
  terrain stays smooth.
- **Chunks compose.** grain (±6% luminance, world-anchored), windSway (height² sway, off
  under reduced motion), foliageTint (vertex alpha masks crown from trunk; the instance colour
  tints crowns only), edgeFade and a terrain splat chunk install through one helper that joins
  their keys into `customProgramCacheKey`; the D1 lattice chunk now composes with them. Each
  has a pure TypeScript mirror under test.
- **Edge fade has to undo tone mapping.** The background clear colour is not tone mapped but
  lit fragments are: `NeutralToneMapping` takes 0.04 off every linear channel of the haze,
  about 5/255 darker in sRGB (calculated), which would leave a seam where the fade meets the
  background. The fade therefore targets the haze run backwards through the tone map (exact
  below its compression start; a test round-trips it at exposures 0.8–1.2), recomputed when
  the tweak panel changes exposure. Not established: that no seam shows on every display.
- **Data textures as planned, one resolution off.** The splat map is RGBA8 at 1 m per texel
  (1,998 × 1,494 on the default map) with a categorical RG8 field map read by `texelFetch`
  for crop and furrow heading. The AO tint map is R8 at 1,024², which on a 2.0 × 1.5 km map is
  about 1.95 × 1.46 m per texel, not the "about 1 m" of the D11a contract; 1 m would need
  2,048 × 1,536. Painting all three took 59 ms (Node, one run).
- **Draw calls (agent, `renderer.info.render.calls`, one frame each, not a gate result):**
  63 at the Close town bookmark, 64 for the same view at the 30° pitch, 70 at the Default
  start view (forest by the river), 80 in the mid band and 109 at Region. At Far the first
  build drew 229 (bookmark 4) and 240 at the 0.75 ppm minimum, 116 of them tree meshes (one
  per 256 m chunk × species, where chunk culling saves nothing because the whole map is in
  view). Below 2 ppm the trees now switch to one whole-map LOD1 mesh per species (their own
  copy of the instance data, about 1.5 MB at the 20,000-tree cap) and cast no shadows: a
  fresh run drew 121 at bookmark 4 (60 main, 61 shadow) and 127 at 0.75 ppm, with the other
  views unchanged. Programs: 11–13. These are development readings on one machine; only the
  D13 bench runs count against gate B, and track, trains and signals (D3, D8) add to them.
- **Ambient animation** (tree sway and windmill sails) keeps the scheduler's `ambient` reason
  on at 30 fps (58–60 frames in 2 s over two agent runs). With
  `prefers-reduced-motion: reduce` the reason is off, the sway amplitude is 0, and an idle
  page drew 0 frames in 2 s (agent).
- **Bundle:** one 648.7 kB chunk, 176.6 kB gzip (`npm run build`); fonts are separate
  files (EB Garamond Medium, latin 23 kB and latin-ext 65 kB woff2).
- **Deferred:** chimney smoke (the smoke anchors are collected in world space, but no puffs
  are drawn); shore foam; shadows for swaying trees use the unswayed depth material.
- **Observation for the owner, not changed here:** with the D1 sun (left of and toward the
  camera), cast shadows fall to the right and slightly up the screen, while art direction
  says they fall toward the lower right. Which one is intended is a Look Gate A question.

## Findings (2026-09-27, terrain look variants)

Recorded on branch `codex/terrain-crisp-look` at `31bc24f` (from the D3 branch at
`c699393`) after the owner found the ground "too blurry/flat" (relayed to the implementing
agent). Automated tests (Vitest in Node) and an **agent** browser run (headless Chrome through
Playwright, 1280 × 800 at DPR 1, Apple M5 Pro, ANGLE Metal). The status of this ADR stays
**Proposed**; nothing here is a look verdict, and the owner chooses among the variants
([art direction](../art-direction.md#terrain-look-variants-2026-09-27)).
- **Decision 3 held, with two chunk additions.**
  - A `relief` chunk ([`relief.ts`](../../src/render/art/shaderChunks/relief.ts), keys
    `terrain-relief-v1` and `-facets`) steepens the shading normal's slope after three's
    normal chunk. It optionally adds each lattice triangle's plane as facet detail and draws
    a contour hint.
  - The splat chunk gained opt-in crisp edges and ground detail
    ([`groundDetail.ts`](../../src/render/art/shaderChunks/groundDetail.ts)), as
    `terrain-splat-v3-crisp-detail`.
  - Without options the splat is D11a's `terrain-splat-v2`, byte-identical. Each new piece
    has a float64 mirror under test.
  - Still one terrain material. The program count in the captures is unchanged (11–13), and
    so are the draw calls.
- **"Smooth terrain" is contested by variant `b`,** which adds facet shading as detail on top
  of smooth normals. That is a proposed departure pending the owner's choice; variant `a`
  keeps smooth-only shading. The facets are not toon banding: the lighting stays continuous
  Lambert.
- **Decision 6 held.** No post-processing: everything is in the terrain material. The
  lighting recipe, palette values and data-texture resolutions are unchanged, and no token
  or texture was added.
  - The variants set 8× anisotropic filtering on the splat and AO maps. Its measured cost was
    about 0.
  - The variants' shading normals come from heights smoothed twice (presentation only). Under
    the slope gain, the Int16 heights' 1 dm steps otherwise streak along the lattice rows.
- **Cost** (agent development readings, not gate B), from back-to-back renders closed by a
  `readPixels`:
  - 0.08–0.33 ms more per frame at 1280 × 800 across the captured views (0.44 → 0.72–0.77 ms
    at Region grassland);
  - 0.36–0.82 ms more at 2560 × 1600;
  - draw calls unchanged.
  - Every detail layer sits behind a uniform branch, so D11b's presets can drop layers at no
    program cost.
  - The initial JS grew by 3.5 kB gzip (274.49 → 278.02 kB).
  - `EXT_disjoint_timer_query_webgl2` readings exceeded the synchronous frame time on ANGLE
    Metal, so no GPU times are recorded.
- **Not established:** the owner's reading of any variant, the mid laptop, real DPR 2
  (headless Chrome kept the canvas at its CSS size) and the Low preset.

## Findings (2026-09-27, render pass iteration)

Recorded on branch `codex/render-earthworks-terrain`, code at `b864b05` (from `329b69a`,
draft PR [#83](https://github.com/Kminkjan/infrastructurio/pull/83)). The trigger was owner
feedback on look `b` with earthworks, as relayed to the implementing agent: the owner picked
"Facets too strong/noisy" and wrote "The groundwork/dirt seems very pixely", then "Still a bit
wonky". The look side is in
[art direction](../art-direction.md#render-pass-iteration-2026-09-27) and the geometry in the
[ADR 0010 finding](0010-triangular-lattice-track-geometry.md#findings-2026-09-27-render-pass-iteration).
The evidence is automated tests (Vitest in Node) and an **agent** browser run (headless
Chrome through Playwright, 1280 × 800 at DPR 1, Apple M5 Pro, ANGLE Metal). The status of this
ADR stays **Proposed**; nothing here is a look verdict.
- **Decision 3 held: still one terrain material and isolated chunks,** with new cache keys.
  - [`earthwork`](../../src/render/art/shaderChunks/earthwork.ts) (`terrain-earthwork-v2`)
    reads a vec3 attribute: the encoded potential, the departure, the centreline distance.
    It declares the attribute, the varying and two weight helpers (lip, earthwork) once per
    shader, behind a `TERRAIN_EARTHWORK` define. Its colours are grass, a 12% grass-light
    tint on steep slopes, `earthworkFace` on the lower batter of deep cuts, and
    `earthworkBed` on a cut shoulder.
  - The splat gained an `earthwork` option (`terrain-splat-v4…-earthwork`), which the terrain
    material always sets. It fades fields, roads, forest floor and the AO tint by the
    earthwork weight, and the slope soil by the lip.
    - Without options the splat is still D11a's `terrain-splat-v2`, byte-identical.
    - The terrain material's key changes for every look, `d11a` too, but natural ground
      renders as before.
  - The relief chunk (`terrain-relief-v2`) fades its facets by the lip, under the same
    define.
  - [`groundDetail`](../../src/render/art/shaderChunks/groundDetail.ts) gained a soft edge
    for the tone patches and meadow flecks, patch mixes and fleck cut levels as settings, and
    a soil mask. At its defaults, and in look `a`, it is as before.
  - Every new piece has a float64 mirror under test.
- **"Smooth terrain" versus facets.** Look `b` keeps its facets (the owner's choice), at 0.8
  instead of 2.5, and they are gone on earthworks, whose refined triangles they drew as
  stair-steps. Look `b`'s ground detail was calmed:
  - patches 26 m, mixes 0.08/0.07, soft edges;
  - flecks 0.5 at cut levels 0.97 → 0.80;
  - tufts 0.2.

  The before and after table is in art direction. Looks `a` and `c` are unchanged, except that
  `c` still follows `b` plus contours.
- **Decision 6 held.** No post-processing, the same lighting recipe, and no palette token
  added or changed. No texture was added. Two tokens (`earthworkFace`, `earthworkBed`) have
  narrower roles.
- **Cost** (agent development readings, not gate B; two runs of each build, each figure the
  mean of 60 back-to-back renders closed by a `readPixels`).
  - Look `b` at 1280 × 800 moved by −0.02 to +0.03 ms per frame across the eight captured
    views (for example Region grassland 0.782/0.772 → 0.762/0.760 ms, bookmark 4
    1.022/1.018 → 1.043/1.040 ms).
  - At 2560 × 1600 it moved by at most +0.06 ms.
  - Draw calls are identical.
  - The initial JS grew from 285.89 to 287.31 kB gzip.
  - The vec3 attribute triples the attribute memory of every terrain chunk: 12 instead of
    4 bytes per vertex, zeros on natural ground. Not measured on the GPU.
- **Not established:** the owner's reading; Look Gates A and B; the mid laptop, real DPR 2 and
  the Low preset. Nor whether the soft patch edges (median ±3.5 m on the noise mirror) read as
  calm or, again, as soft blotches.

## Findings (2026-09-28, PR #83 review fixes)

Recorded on branch `codex/render-earthworks-terrain`, code at `8635640` (from `81663f8`,
draft PR [#83](https://github.com/Kminkjan/infrastructurio/pull/83)). The trigger was a code
review of the PR in recall mode (13 findings, not adversarially verified); each was checked
against the code before it was fixed. The evidence is automated tests and an **agent**
capture (headless Chrome, 1280 × 800, Apple M5 Pro, ANGLE Metal, reduced motion, compared
pixel for pixel). The status of this ADR stays **Proposed**; nothing here is a look verdict.
- **`d11a` compiles D11a's splat again.** The render pass iteration made the terrain material
  always set the splat's `earthwork` option, so `?terrain=d11a` compiled
  `terrain-splat-v4-earthwork`, and the claim that it was the look Look Gate A scored had no
  test behind it.
  - Now the option is opt-in (`earthworkSplat`): looks `a`–`c` set it, and `d11a` compiles
    D11a's `terrain-splat-v2` plus the `terrain-earthwork-v2` chunk. Earthworks are
    independent of the look.
  - The claim is now "identical where no track is built". A test pins d11a's chunk list, the
    splat GLSL (a hash recorded from `createSplatChunk` at `61bd690`, equal at `b0a7500`, the
    Look Gate A record) and the diorama bake (normals, colours and water rings, recorded at
    `61bd690`). Where no track is built every terrain vertex carries a zero earthwork
    attribute, which the earthwork chunk reads as no weight.
  - Agent capture: d11a's four bookmarks, which build no track, are pixel-identical before and
    after. With track built, the d11a curve views differ only on the earthworks: D11a's
    splat still draws the forest floor and its AO tint on the formation beside the straight.
- **Look `b` is unchanged.** Its eleven render-iteration captures are pixel-identical before
  (`81663f8`) and after all review fixes, the seam and reach fixes included.
- **Single sources.** One `smoothstep` for render (`render/math.ts`) replaces eight private
  copies, which a test shows return the same values, edge cases included.
- **Not established:** the owner's reading; Look Gates A and B; how any of this reads on
  other GPUs.

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
- 2026-09-26: D11a lookdev findings added (asset registry, budgets, six materials, composed
  chunks, tone-mapped edge fade, data textures, agent draw calls); status unchanged, still
  Proposed.
- 2026-09-27: terrain look variant findings added (a relief chunk, the splat's crisp and
  detail options, contested smooth-terrain shading in variant `b`, agent frame costs); status
  unchanged, still Proposed.
- 2026-09-27: render pass iteration findings added (the earthwork chunk's vec3 attribute and
  grass-first colours, the splat's earthwork option, facets faded on earthworks, look `b`
  calmed, agent frame costs before and after); status unchanged, still Proposed.
- 2026-09-28: PR #83 review findings added (`d11a` compiles D11a's splat again, identical
  where no track is built and pinned by a test; the splat's earthwork option is opt-in; look
  `b` pixel-identical before and after the fixes; one `smoothstep`); status unchanged, still
  Proposed.
