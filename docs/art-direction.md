# Art direction

**Status (2026-09-26):** the rail-first reset set this direction. The renderer and camera are
Accepted in [ADR 0009](decisions/0009-render-isometric-threejs.md). The art pipeline behind
this page (procedural first, `AssetRegistry`, palette, lighting, no post in the base look) is
Proposed in [ADR 0013](decisions/0013-rendering-and-art-pipeline.md). **No part of the look
has been judged yet.** The owner scores it at Look Gate A (D11a) and Look Gate B (the M4
walkthrough). Every spec number here comes from the design passes: they are starting values
for lookdev, not measured results. Derived pixel and count figures are marked as
calculated. Since D1 (2026-09-26) [`src/app/main.ts`](../src/app/main.ts) shows seeded
terrain, water, lighting and the lattice overlay under the isometric camera. Since the D11a
lookdev spike (2026-09-26, branch `codex/d11a-lookdev`) it also shows the static Baltic
diorama: the full palette, the scenery kit (trees, the building grammar, props), the terrain
splat and AO tint map, CSS2D place names, a CSS vignette, the dev tweak panel and the four
Look Gate A bookmarks ([below](#look-gate-a-bookmarks-d11a)). It is a first pass for the
owner to judge, not evidence that this page is met.

Related: [vision](vision.md) · [prototype plan](prototype-plan.md) ·
[backlog](backlog.md) (D11, [#75](https://github.com/Kminkjan/infrastructurio/issues/75)) ·
[architecture](architecture.md) ·
[`src/render/CLAUDE.md`](../src/render/CLAUDE.md) ·
[M4 acceptance gates](evidence/m4/2026-09-26-acceptance-gates.md)

## Mood pillars

1. **A tiny world someone made.** The map reads as a diorama on a table: low-poly forms with
   flat-shaded facets, soft contact shadows, trees about 15% oversize, rails 1.5× thicker than
   scale. Small life runs everywhere: trees sway, windmill sails turn, steam puffs rise and
   turnout blades throw. Nothing looks plastic, glossy or photoreal.
2. **Calm, muted, warm.** It is a late-summer morning in the Baltic countryside around 1900:
   a hazy sky, low-saturation greens and straw, cream stucco and orange tile under a warm
   morning sun. Every world colour comes from the palette. The few strong world colours
   (tile roofs, buffer red) are small accents by area.
3. **Quiet world, loud information.** Bright, high-chroma colour is reserved for what the
   player must read: block overlays, build states, signal aspects and the invalid ghost.
   Anything that bright that is not information is a defect.
4. **The railway is the subject.** Track, signals and trains stay legible at Default zoom
   whatever the scenery does. Scenery never competes with the track for contrast, and it gives
   way where track is built.
5. **Period-plausible, not a reconstruction.** Forms come from 1900 Baltic and Russian-Empire
   sources: the broad-gauge look, semaphores, stucco towns, wooden farmsteads, a twin-tower
   church. They are simplified so they read well. Nothing claims historical accuracy.

## Originality rules

*Mighty Tiny Railways* ([Steam page](https://store.steampowered.com/app/4456190/Mighty_Tiny_Railways/))
is the **mood reference only**. What we share with it is genre, mood and common
rail-builder conventions: an isometric 2.5D steam-era Baltic diorama with a calm palette,
plus lattice snapping and block and chain signals, specified independently in ADRs
[0010](decisions/0010-triangular-lattice-track-geometry.md) and
[0011](decisions/0011-signalling-and-reservation.md). Every asset, colour value, name, icon, layout
and string in Infrastructurio is our own.

- **Never** put any of the following in the repo, or in issues, PRs or evidence records: its
  screenshots, video captures or crops; traced silhouettes; colour values sampled from its
  captures; its UI layout, icons or strings; its place, company or vehicle names. The mood
  board links to its Steam page instead.
- **Palette values** come from the public-domain sources below, or from in-house tuning in
  the lookdev tweak panel. Never eyedrop them from reference-game captures. The header of
  [`palette.ts`](../src/render/art/palette.ts) says the same.
- **Vehicle and building forms** come from generic period types (an 0-6-0 tank engine, a
  stucco townhouse), never from another game's models.
- **Station names** come from the core's Baltic name list, which must be built from real
  regional place-name patterns, never from the reference game.
- **Originality is scored at both look gates** (see [Look gates](#look-gates-a-and-b)). An
  agent that notices a resemblance, such as a matching HUD layout or a familiar silhouette,
  raises it as an issue before the gate. The owner decides. When in doubt, change the asset.

### Public-domain mood sources

Link to these; don't commit them. If a public-domain image ever has to be committed, its
source URL and rights statement go next to it. The Library of Congress marks both of its
collections below "No known restrictions on publication". That is an advisory, not a licence,
so confirm it per item.

| Source | Take from it | Link |
|---|---|---|
| Library of Congress Photochrom prints, 1890–1905: Riga, Vilnius (then "Vilna"), Baltic villages | stucco and roof colours, street and cobble tones, sky haze, the density of the town fabric | [collection](https://www.loc.gov/pictures/collection/pgz/) |
| Isaac Levitan (1860–1900), landscapes | meadow and birch greens, warm overcast light, low horizons, river light | [Commons](https://commons.wikimedia.org/wiki/Category:Paintings_by_Isaac_Levitan) |
| M. K. Čiurlionis (1875–1911), paintings | layered blue-green distance and haze, a soft value structure | [Commons](https://commons.wikimedia.org/wiki/Category:Paintings_by_Mikalojus_Konstantinas_%C4%8Ciurlionis) |
| Period railway photographs, for example the Prokudin-Gorskii colour survey (1905–1915; the 1915 Murmansk railway series shows stations, depots and bridges) | railway hardware, masonry and steel colours, station forms. It is slightly later than the setting, so don't use it for town fabric | [collection](https://www.loc.gov/collections/prokudin-gorskii/) |

## Palette

**[`src/render/art/palette.ts`](../src/render/art/palette.ts) is the single colour source** for
the renderer and the HUD.
- No other file in `src/render`, `src/ui` or `src/app` may contain a hex colour literal.
- Shaders receive palette values as uniforms.
- The HUD receives them as CSS custom properties set from `palette.ts` at start-up.
- A colour change edits `palette.ts` and this table in the same PR. If the two disagree, the
  code wins and this page is corrected.
- A source-scan rule in [`tests/architecture.test.ts`](../tests/architecture.test.ts)
  rejects hex colour literals outside `palette.ts` (added in D11a, with a negative
  self-check). `index.html`'s first-paint background duplicates the haze and a test holds
  them equal.

**Status (2026-09-26, D11a):** `palette.ts` holds the whole table below as 70 named tokens
(pairs and ramps get their own names: `spruceLight`, `roofTileDark`/`roofTileLight`,
`steamEnd`, `block1`–`block6`, …) plus one in-house token the table does not list (71 in all):
**forest floor `#71704F`**, the splat colour under dense forest, tuned by eye in D11a and open
at Look Gate A. The colour-blind overlay set still has no values (D7). A source-scan rule in
[`tests/architecture.test.ts`](../tests/architecture.test.ts) now rejects hex colour
literals in `src/render`, `src/ui` and `src/app` outside `palette.ts`.

**D3 (2026-09-27):** one token joins the UI group, **amber `#D9A13B`** (`signalAmber`), the
construction tooltip's middle grade band (green ≤ 1.5 %, amber up to the 3.5 % maximum, red
above it; signal green and red are the outer bands), so the table now has 71 tokens (72 with
`forestFloor`). Chosen in-house, not yet judged at a look gate. The ghost, snap ring, drop
lines, end-height tags, rejection highlight and undo flash use the existing build-state and
UI tokens; the HUD reads them as CSS custom properties that `src/app` sets from `palette.ts`
at start-up (`src/ui` never imports render).

**Earthworks-lite (2026-09-27):** two in-house tokens join the ground group:
**earthwork face `#9E8A6C`** (`earthworkFace`, cut and fill slopes) and **earthwork bed
`#7B705E`** (`earthworkBed`, the formation beside the ballast, darker so the ballast reads
on it). The table now has 73 tokens, 74 with `forestFloor`. They were chosen in-house and
are not yet judged at a look gate. See [Terrain and water](#terrain-and-water).

| Group | Colours |
|---|---|
| grass | `#8FA66B`, light `#A9BA7E`, shade `#6E8752`, meadow `#C2BE7C` |
| forest | spruce `#3F5A3C`/`#4F6B45`, pine crown `#5A7048`, deciduous `#7E9A4F`/`#93A85A`, birch trunk `#E8E2D0` |
| ground | soil `#A88F6A`, dirt road `#B8A07A`, cobbles `#A39C90`/`#8E877B`, rock `#9A9486`, forest floor `#71704F` (D11a, in-house), earthwork face `#9E8A6C` and bed `#7B705E` (earthworks-lite, in-house) |
| fields | rye `#C9B26B`, hay `#BFB27A`, crop `#9DAE6A`, fallow `#A38B62` |
| track | ballast `#8C8578`/`#7A7368`, sleepers `#5A4636`, rail top `#B7B3AA`, sides `#55524D` |
| walls | stucco `#E9DFC8`, ochre `#E3CFA6`, blush `#D9C3B0`, sage `#C9D3C5`, lime white `#F1ECE0`, brick `#9C5A44`, timber `#8A6E55`/`#6C5A48` |
| roofs | tile `#C0643F`/`#B45A3A`/`#CD7650`, slate `#5E6166`, shingle `#7D6B5A` |
| water | `#6F9AA0`, deep `#4D7A84`, foam `#D8E3DC` |
| stock | loco `#2F3B33`, brass `#B08D57`, buffer red `#9C3B30`, coach maroon `#6E3434`, coach green `#3F5B4A`, cream panel `#E6DCC3`, wagon grey `#6F6A62` |
| air | haze `#DCDCCB`, steam `#F4F2EC` → `#CFCAC0`, smoke `#B9B4AA` |
| light and grid | sky `#D6E4EC`, ground bounce `#6B6A4E`, sun `#FFE8C2`, lattice line `#F2F0E6` |
| UI | parchment `#F3EDE0`, border `#D8CCB4`, ink `#3B3A36`, brass `#B08D57`, signal red `#C8453A`, green `#5E9C5A`, amber `#D9A13B` (D3) |
| build states | ghost valid `#FFFFFF`, invalid `#E0584C` (dashed), reused `#7FD1E8`, snap `#8FD694` |
| block overlay | `#F2C94C`, `#4FC3D9`, `#D65DB1`, `#F08A4B`, `#8C7AE6`, `#F4F4F4`, plus a colour-blind-safe set; one-way blocks always get chevrons |

- **World groups** (grass through air) are muted. **Information groups** (build states,
  block overlay, signal red and green) are bright and high-chroma, which is pillar 3 made
  concrete.
- **Paired values** (spruce `#3F5A3C`/`#4F6B45`, the three roof tiles) are the variation set.
  Instances pick among them or blend between them through `foliageTint`. Never invent a
  third value in code.
- **Steam** is a ramp over each puff's life, not two separate colours. UI brass and stock
  brass are one token.
- **Colour is never the only signal.** Invalid ghosts are also dashed, and one-way blocks
  carry chevrons in both overlay sets.
- **The colour-blind-safe overlay set has no values yet.** D7 picks them. The recommended
  starting point is the Okabe–Ito set, desaturated slightly to sit on the muted ground, then
  checked under protan, deutan and tritan simulation.
- **Colour management:**
  - Palette hex values are sRGB.
  - Write vertex and instance colours through a `THREE.Color`, which holds linear working
    space, never from raw hex bytes. Raw sRGB bytes in a colour attribute are treated as
    linear and encoded to sRGB again on output, so the diorama comes out light and washed
    out.

## Light

| Setting | Value |
|---|---|
| Output | `SRGBColorSpace`, `NeutralToneMapping`, exposure 1.0 |
| Sky fill | `HemisphereLight(#D6E4EC, #6B6A4E, 1.1)` |
| Sun | `DirectionalLight(#FFE8C2, 2.4)` at 42° elevation, from the screen's upper left, **locked to camera yaw** |
| Sun shadow | `PCFShadowMap`, intensity 0.72, radius 3, bias −0.0004, normalBias 0.03 |
| Shadow map | one map fitted to the view footprint with texel snapping; no cascades. Size set by the quality preset |
| Ambient occlusion | baked vertex AO in procedural geometry, plus a world AO tint map on the terrain |
| Background | haze `#DCDCCB` |
| Frame | CSS vignette (Medium and High); optional tilt-shift (High only, off while a construction tool is active) |

- **The sun turns with the camera,** so across all six yaws the shadows fall toward the lower
  right of the screen and keep the same length. At 42° a shadow is about 1.11× the height of
  its object (1/tan 42°).
- **Texel snapping** stops shadow edges shimmering while the camera pans. One fitted map is
  enough because an orthographic view has a bounded footprint.
- `PCFSoftShadowMap` is deprecated in three r185, so softness comes from PCF plus `radius`.
- **Baked AO carries the Low preset.** With the shadow map off, the vertex AO and the tint
  map are the only contact cues, so they must hold up alone.
- D1 (2026-09-26) uses the hemisphere and sun values (sun at 42°, first fixed in `ac1e6a7`)
  and `NeutralToneMapping`, fits one shadow map to the view footprint with texel snapping,
  and locks the sun to camera yaw (`art/lighting.ts`, `art/shadowFit.ts`). D1's terrain
  alone casts no visible shadow: with `FrontSide` materials three draws back faces into the
  map, and no slope reaches the 48° a heightfield needs to show the sun one (the golden
  map's steepest is 33°); nor can a slope under 42° shade its neighbour. The map is there
  for the casters D4 and D11a add (bridges, trees, buildings).

## Materials

- **`MeshLambertMaterial` plus vertex colours and instance colours**, about 12 materials in
  total. A material exists for each distinct shader-chunk or blend combination, never for a
  colour: colour is data.
- **Flat shading** for trees, roofs and rocks, so the facets catch the sun and read as made
  by hand. **Smooth shading** for terrain, so its lattice triangles don't glitter as facets.
  The lattice overlay shows the grid when it is wanted.
- **Rejected:**
  - `MeshToonMaterial`: its banded ramps read as cartoon, which fights the photochrom mood.
  - `MeshStandardMaterial`: it needs an environment map to look right, and it costs more per
    fragment. Its roughness and metalness also invite per-asset tuning outside the palette.
- **Shader chunks** live in `src/render/art/shaderChunks`. Each is an isolated
  `onBeforeCompile` module and must set `customProgramCacheKey`, so patched materials share
  programs without cache collisions.
- **D11a status (2026-09-26):** six materials in
  [`art/materials.ts`](../src/render/art/materials.ts) and the lattice overlay: terrain,
  water, foliage, built (the walls, roof, trim, metal and sails slots share one chunk
  combination, so each chunk of buildings is one draw), glass (no grain) and props. All
  chunks below exist; `splat` joined them for the terrain (see [Terrain](#terrain-and-water)).
  `edgeFade` targets the haze run backwards through `NeutralToneMapping`, because lit
  fragments are tone mapped and the background is not.

| Chunk | Does |
|---|---|
| `grain` | world-space noise, ±6% luminance. It is anchored to the world, so it doesn't swim when the camera pans |
| `lattice` | the construction lattice overlay on terrain (see [Terrain](#terrain-and-water)) |
| `windSway` | vertex sway on foliage. It stops whenever ambient animation is off |
| `foliageTint` | per-instance variation between the paired forest tokens |
| `edgeFade` | fades the terrain's outer border into the haze |

## Terrain and water

- **Mesh:** the lattice triangles themselves, one vertex per node at the sim's height (Int16
  dm). The terrain doubles as the low-poly mesh. It is chunked, with a coarser LOD in the far
  band, and smooth-shaded.
- **Surface:**
  - a grass base, with a splat map for dirt, cobble, field and forest floor, taken from the
    ground and fields groups;
  - recommended: fields as narrow strips in rye, hay, crop and fallow, which is the period
    village pattern;
  - `grain` over everything, and the world AO tint map darkening ground under trees,
    buildings, structures and along the track.
  - D11a status (2026-09-26): the splat is RGBA8 at 1 m per texel (dirt for roads, lanes and
    farm yards; cobble for town squares and streets; field; forest floor), with an RG8 field
    map read by `texelFetch` for each strip's crop (rye, hay, crop, fallow) and furrow
    heading, drawn as 1.4 m stripes. The AO tint map is R8 at 1,024² over the map (about
    1.95 × 1.46 m per texel on the default map): canopy, each tree, and a 4 m contact band
    around buildings, box-blurred. Splat colours keep the vertex colour's relative
    brightness, so baked hollows still read under roads and fields.
- **Earthworks:**
  - Near ground-level track, the renderer lowers or raises terrain vertices to form cuttings
    and embankments, and adds ballast skirts.
  - This is **render-only**: the sim's terrain heights, and the validation that reads them,
    never change.
  - **Earthworks-lite status (2026-09-27; the owner pulled D4's conform forward; look not
    judged):**
    - Ground track sits on a 6 m flat bed at its own height, 0.15 m under the ballast top,
      with 1 : 1.5 side slopes to natural ground. Cuts win over fills. Moves up to 5 cm stay
      natural.
    - Affected lattice triangles are refined 4 × 4, so the track always shows, curves
      included.
    - The terrain shader paints moved ground by slope: `earthworkBed` on the flat,
      `earthworkFace` on the slopes. The weight ramps from 5 cm to 50 cm of movement and is
      clamped per fragment, so a cutting's edge is a clean line. Fields, roads, forest floor
      and the AO tint fade out there.
    - Ballast skirts are not built. The numbers and the mesh choice are in the
      [ADR 0010 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-27-earthworks-lite).
- **Water:** opaque (no transparency sorting), depth-tinted from `#6F9AA0` to deep `#4D7A84`,
  with foam `#D8E3DC` along shores.
- **Lattice overlay:**
  - three line families, drawn as `fwidth`-antialiased 1 px lines in `#F2F0E6` with 1.5 px
    node dots;
  - opacity 0 in view mode;
  - in build mode, 0.15 globally and 0.55 within 48 m of the cursor;
  - it fades out wherever the lines would be less than 5 px apart;
  - precision mode shows a finer sub-lattice.
- **When the lattice fades:** the yaw steps match the lattice, so at every yaw the parallel
  lines sit 2.50–3.54 m·ppm apart on screen (4.33 m foreshortened by sin 35.264° at
  worst). In pixels, that is 2.3–3.2 px at Far (faded), 6.3–8.8 px at Region (shown) and
  15–21 px at Default. These are calculated from the numbers above, not measured.

## Track

Track is built as three `BatchedMesh`es (ballast, sleepers, rails) along the analytic lines
and arcs of the `NetworkView` render prims. Curves are sampled through
`src/core/geometry/sample.ts`, so curve maths has a single source.

| Part | Spec |
|---|---|
| Arc sampling | Δθ = min(2·acos(1 − 0.02/r), 5°), chord error ≤ 2 cm. For our radii the chord term always governs: 3.0° at R 60 m, 2.5° on shifts (R ≈ 82 m), 1.2° at R 360 m |
| Ballast | trapezoid (−2.2, −0.35) (−1.6, 0) (1.6, 0) (2.2, −0.35) m: 3.2 m top, 4.4 m base. `#8C8578`/`#7A7368` (recommended: light top, darker shoulders) |
| Sleepers | 2.6 × 0.14 × 0.24 m every 0.9 m, `#5A4636` |
| Rails | 0.11 × 0.16 m at ±0.817 m, top `#B7B3AA`, sides `#55524D` |
| Turnouts | long timbers under the fan; blades animated from `FrameView.switchLeg` |
| Far LOD (< 4 ppm) | sleepers hidden; the ballast carries a stripe pattern instead |
| Fallback | if multi-draw is missing, chunk-merged meshes behind the same `TrackBatch` interface |

- **Broad gauge, visual only.** The rail centres at ±0.817 m, less the 0.11 m head, leave a
  1.524 m gap between inner faces: the period Russian-Empire Baltic broad gauge. The sim has
  no notion of gauge. Clearance runs on plan distance (4.0 m), and double track sits one
  lattice row (4.33 m) apart.
- **Double track** at 4.33 m centres: the 4.4 m ballast bases just merge into one bed, and the
  tops stay 1.13 m apart. Parallel track reads as a shared formation, which is intended.
- **The far-LOD threshold (4 ppm) sits inside the mid band** (2–5 ppm). That fits the
  numbers: below 4 ppm the sleeper pitch falls under 2.1–3.6 px (calculated) and would
  shimmer.
- **D3 status (2026-09-27, [PR #82](https://github.com/Kminkjan/infrastructurio/pull/82); look not judged):** the table's
  dimensions and arc sampling are implemented in
  [`render/track/trackGeometry.ts`](../src/render/track/trackGeometry.ts). Choices the table
  leaves open: sleepers are spread evenly per piece at round(L / 0.9 m); rails stand on the
  sleepers (0.14–0.30 m); the whole track is lifted (render-only) so the ballast top never
  z-fights the terrain it lies on: 5 cm at first, 15 cm since 2026-09-27, when track began to
  follow the ground and the terrain between nodes could otherwise cover the rails (measured in
  the [ADR 0010 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-27-d3-ground-following));
  the far-LOD stripe is a centre band ±0.85 m wide in the
  sleeper colour (a vertex attribute and the `trackStripe` chunk), and the rails stay. Turnout
  timbers, blades and earthworks are not built yet. (Earthworks since 2026-09-27: see
  [Terrain and water](#terrain-and-water).)

## Structures

Where a piece's structure is bridge (it sits more than 4 m above terrain, or crosses water),
choose the type per span, first match wins:

1. over water → **steel Warren truss**;
2. clear span over 30 m → **steel Warren truss**;
3. span over another track → **plate-girder overpass**;
4. over land at 4–20 m → **stone arch viaduct**.

- A long bridge may mix types, such as viaduct approaches with a truss over the river, which
  is period-typical.
- **Piers never stand on other tracks**, and never in the clearance of other tracks.
- **Tunnels** get a masonry portal face at each end and a hill plug, so the hill reads as
  closed over the bore.
- **H hides decks** and **U gives the underground x-ray.** Both are construction and picking
  aids. Neither changes the look at rest.
- **Open:**
  - Over land above 20 m, no type is specified. The recommendation is a truss on masonry
    piers; D4 settles it.
  - The palette has no masonry or structural-steel token. The recommendation is masonry
    close to rock `#9A9486` and steel close to loco `#2F3B33`; D4 adds the tokens.

## Trees and scenery

- **Trees** are instanced: spruce, pine and deciduous/birch, each at 2 LODs, flat-shaded,
  about 15% oversize, swaying through `windSway`. Colours are spruce `#3F5A3C`/`#4F6B45`,
  pine crown `#5A7048`, deciduous `#7E9A4F`/`#93A85A` and birch trunk `#E8E2D0`. The bench
  scene `bench-m4` carries 15k trees, and D11a sets a per-tree triangle budget against it.
- **D11a status (2026-09-26):** per-tree budgets are set: 60–120 triangles at LOD0 and 24–30
  at LOD1 (spruce 68/26, pine 72/24, birch 70/28). Trees are instanced per 256 m chunk and
  species, LOD1 below 4 ppm sharing LOD0's instance matrix and colours; scale 0.8–1.3 on top
  of the 1.15 oversize, random yaw, crown colour blended between the species pair plus a
  small sRGB HSL jitter. Below 2 ppm one whole-map LOD1 mesh per species replaces the
  chunk meshes (three draws where the whole map is in view) and trees cast no shadows. The
  golden diorama holds the 20,000 cap: forest stands, garden trees in the towns and birch
  avenues along the roads.
- **Props:** telegraph poles every 50 m along the line, lamps, fences and haystacks.
- **Scenery gives way to infrastructure.** Recommended rule: trees and props inside a piece's
  corridor (ballast plus a margin) hide on that network revision, and return on undo or
  demolish. The design passes do not specify this yet; D3/D4 settles it.
  - Earthworks-lite (2026-09-27, a default to test): trees and props hide where their trunk
    or post stands within 5 m of a ground-track centreline (the 3 m bed plus 2 m), or where
    earthworks moved the ground by more than 10 cm, and return on undo.
  - Field strips fade out over moved ground. Buildings are not moved: on the diorama, 8.5%
    of test plans have earthworks that reach a building lot.
- **Ambient animation** (sway, windmill sails, chimney smoke) runs at 30 fps and stops under
  reduced motion or power saver. Train motion, blades and steam are simulation feedback and
  are not ambient.

## Buildings

Buildings come from a procedural grammar and are merged per chunk:

> footprint × floors (1–3) × roof (gable / hip / mansard / tower) × wall and roof
> material × details (inset windows, doors, cornice, chimneys that anchor smoke, dormers)

**Budget:** ≤ 600 triangles each, and ≤ 1,500 for a hero building. The hero allowance is
for landmarks such as the twin-tower church; keep it to a handful per map. The bench
scene's 150 buildings therefore stay near 90k triangles (150 × 600, plus the hero excess).

| Kind | Recommended binding | Budget |
|---|---|---|
| Stucco townhouse | 2–3 floors; stucco, ochre, blush, sage or lime white; tile roof; cornice | 600 |
| Baltic wooden house | 1 floor plus dormer; timber; shingle or tile | 600 |
| Brick warehouse | 1–2 floors; brick; slate | 600 |
| Twin-tower church (the landmark) | lime white or stucco; tower roofs | 1,500 (hero) |
| Station with canopy and clock | placed automatically by the station tool; canopy along the platform | 600 |
| Engine shed | brick; slate; beside depots | 600 |
| Water tower | masonry base, timber tank | 600 |
| Post windmill | timber, shingle; the sails rotate (ambient) | 600 |
| Farmstead | timber house and barn, haystacks, adjoining field strips | 600 |

The bindings are recommendations for D11a. Kinds and budgets come from the design passes.

**D11a status (2026-09-26):** [`scenery/buildings/grammar.ts`](../src/render/scenery/buildings/grammar.ts)
builds all nine kinds with the bindings above (townhouses 2–3 floors with gable, hip or
mansard roofs; the church's towers carry the tower roof), inset windows (dark pane, stone
sill and lintel), doors with a step, cornices, chimneys that anchor smoke, dormers and
lime-white corner boards on timber houses. Measured budgets are in ADR 0013's D11a
findings; the church uses 528 of its 1,500. Buildings are merged per 256 m chunk, material
and LOD (silhouettes below 2 ppm). The station, water tower and engine-shed models stay in
the kit for D6, but the scenario no longer places them: the owner had them removed on
2026-09-26 (diorama generator version 2), because stations and depots are player-built.

## Rolling stock

Vehicles are an `InstancedMesh` per vehicle type. Each vehicle is placed from two anchors,
`bogie_front` and `bogie_rear`, evaluated along the path, and the body takes pitch and cant
from them. On four-wheelers and six-coupled engines these anchors are axle positions, not
true bogies.

| Vehicle | M4 role |
|---|---|
| 0-6-0 tank engine (10 m) | the only M4 locomotive. A terminus reverses the train in place, bunker-first, so on shuttles the engine runs in reverse on alternate legs and needs a finished bunker end |
| Four-wheel coach with clerestory (9 m, 1 m gaps) | the only M4 coach, 2–4 per train |
| 2-4-0 tender engine, boxcar, open wagon, tank wagon | complete the kit for M5 and later (mixed stock is deferred) |

- The kit-only vehicles are registered but **not placed on the network in M4**: a static
  vehicle on track would read as a stuck train.
- **Livery:**
  - locomotive body `#2F3B33`, brass `#B08D57` fittings, buffer-beam red `#9C3B30`;
  - coaches in maroon `#6E3434` or green `#3F5B4A`, with cream panels `#E6DCC3`;
  - wagons in grey `#6F6A62`.
- **Anchors:** smoke (chimney), `bogie_front`/`bogie_rear`, couplers (`coupler_f`/`coupler_r`)
  and door.

## Steam

- **Puffs:** instanced icosahedra drawn with an `alphaHash` dissolve, which needs no
  transparency sorting and breaks up like real steam. The pool holds 2,000.
- **Emission:** 2/s + 6/s·effort from the smoke anchor (effort taken as 0–1).
- **Motion and colour:** each puff rises at 2.5 m/s, lives 3–5 s and ramps from `#F4F2EC` to
  `#CFCAC0`. Building chimneys use smoke `#B9B4AA` and count as ambient.
- **Headroom (calculated, not measured):** 24 trains at full effort emit 8/s each and live up
  to 5 s, so at most 960 puffs are alive, about half the pool.
- Live particles keep the frame loop running (`particles-alive`) and let it stop once the last
  puff dies.

## Semaphore signals

- **Aspects are display only,** read from `FrameView.signalAspect`:
  - a stop signal shows clear when the next section is free or held by the approaching train;
  - a chain signal also has a partial aspect, shown when its first section is free but a later
    part is blocked.
- **Motion:** the arm eases between positions over 400 ms. Recommended: it snaps under
  reduced motion.
- **Far zoom:** screen-space dots in the aspect colour replace the arms. Signal red `#C8453A`
  and green `#5E9C5A` exist; **the partial aspect has no token yet**, and D7 adds one.
- **Recommended form (D7 decides):**
  - a timber post;
  - an arm in signal red with a light band on the front and lime white on the back, so the
    facing reads from either side;
  - a chain signal with a visibly different arm, such as a second lower arm or a notched end.
    "Chain" is our game concept, not a period aspect, so the form is ours to design. The kind
    must read without the overlay.

## Overlays and construction feedback

- **Block ribbons** come in the 6 overlay colours, with chevrons on one-way blocks. Colours
  stay stable across unrelated edits: a greedy colouring that keeps previous colours.
- **Reservations** show as marching ants in each train's hue. Occupied sections show red.
- **The ghost** draws in two passes: depth-tested at 0.7 opacity and see-through at 0.2.
  - Colours: new white, reused cyan, invalid red and dashed.
  - Elevated ghosts show drop lines every 20 m and end-height tags.
- **Handles** are screen-constant billboards drawn at 6–8 px and picked within 14 px.
- **D3 status (2026-09-27; look not judged):** the ghost is a 2.6 m ribbon 5 cm above the
  drawn rail tops (0.4 m above the track height at first, 0.5 m since the 15 cm track lift of
  2026-09-27), in two passes at 0.7 (depth-tested) and 0.2
  (see-through), dashed 3 m on, 2 m off when invalid; drop lines (ghost-valid white, 0.7) stand
  every 20 m of plan length and at the end wherever the ghost is more than 0.5 m above the
  terrain (the water surface over water, since 2026-09-27), and an elevated ghost tags both ends
  with their height above it in parchment labels. Existing pieces a rejection names are overlaid in the invalid red. An undo
  or redo flashes the added pieces in the snap green and the removed ones in red for 400 ms
  (held, not faded, under reduced motion). The snap ring is a 9 px screen-constant billboard in
  the snap green: filled on an endpoint, hollow on a free node, with a fork glyph on track.
- **Earthworks-lite (2026-09-27):** the ghost is not conformed while dragging. The parts of a
  plan under the natural ground show only through the 0.2 see-through pass until the plan
  is built, and then the terrain is cut under them. On the diorama that is 25% of
  zero-step curve ribbon samples, and 0.3% of straight ones.
- Recommended: give ribbons a minimum screen width so blocks still read at Region and Far.
  D7 sets the value.

## Typography and labels

- **Place names** use a self-hosted OFL serif: an EB Garamond woff2 subset. The subset must
  cover Basic Latin, Latin-1 and Latin Extended-A, so that Latvian, Lithuanian and period
  German spellings render (ā č ē ģ ī ķ ļ ņ š ū ž ą ę ė į ų ä ö ü ß).
- **UI numerals** use `system-ui` or Inter with `font-variant-numeric: tabular-nums`, so
  counters and the clock ("January 1, 1900, 08:00 AM") don't jitter.
  - Recommended: `system-ui` first (zero bytes). Self-host Inter only if the system figures
    disappoint.
  - No font comes from a CDN.
- **Labels** are CSS2D DOM elements (the station label is a `<button>`), so they stay crisp
  and accessible at any zoom. They are ink `#3B3A36` on parchment `#F3EDE0` with border
  `#D8CCB4`. L toggles them. Recommended: declutter by priority at Far.
- **D11a status (2026-09-26):** EB Garamond Medium (latin and latin-ext woff2 subsets, OFL,
  source and licence in [`public/fonts/`](../public/fonts/README.md)) is self-hosted through
  `@font-face` in `index.html`; the UI stays on `system-ui` with tabular figures. Town and
  landmark names (church, windmill) render through a `CSS2DRenderer` over a separate label
  scene; a greedy declutter by priority runs only when the camera changes (or a font loads,
  or a newly shown label needs measuring); town names hide below 0.9 ppm and landmark names
  below 2 ppm. The label layer is a "Place names" group that screen readers can read;
  hidden and decluttered names are `display: none`. Town names come from the core's Baltic
  list (`src/core/scenarios/placeNames.ts`).

## Readability at the named zoom levels

This assumes pitch 35.264°. Pixel figures are calculated for CSS px from the specs above;
they are not measured. Where a figure is a range, it runs from a heading foreshortened by
sin 35.264° to one seen full width.

| Level (ppm) | LOD band | Ballast band | Rail centres | Sleeper pitch | 50 m train | Must read |
|---|---|---|---|---|---|---|
| Far (0.9) | far | 2.3–4.0 px | merged | hidden | 26–45 px | network shape as ballast stripes, water, forest masses, station names, signal dots, trains as blocks |
| Region (2.5) | mid | 6.3–11 px | 2.4–4.1 px (merged) | hidden | 72–125 px | topology and junctions, block overlays, which trains are where; signal aspect (dot or arm, see below) |
| Default (6) | near | 15–26 px | 5.7–9.8 px | 3.1–5.4 px | 173–300 px | the working view: two rails, sleeper rhythm, turnout direction, signal arm and facing, platforms, locomotive vs coaches, steam |
| Close (12) | near | 30–53 px | 11–20 px | 6.2–11 px | 346–600 px | building details, blade throw, liveries |
| Detail (22) | near | 56–97 px | 21–36 px | 11–20 px | 635–1,100 px | the inspection and beauty view: running gear, window insets, puffs |

- **At Default a rail head is only 0.4–0.7 px wide.** Track legibility there rests on the
  ballast band, the dark rail sides and the sleeper rhythm, not on the rail width.
- **On foreshortened headings, the sleeper pitch at Default falls to about 3 px.** Check for
  moiré at Look Gate A. MSAA is the first remedy; raising the far-LOD threshold is the second.
- **Signal dots vs arms:** at Region an arm is only a few pixels long. The switch-over
  therefore probably needs to reach into the mid band, and D7 sets the ppm.
- **Walkthrough zoom levels:** the owner walkthrough judges readability at three levels.
  Recommended: Region, Default and Close. The gates record governs.

## Quality presets

| Preset | DPR cap | Shadows | Anti-aliasing and extras |
|---|---|---|---|
| Low | 1 | none; baked AO only | no post |
| Medium (default) | ≤ 1.5 | 2048 PCF map, radius 2 | default MSAA, CSS vignette |
| High | ≤ 2 | 4096 map | `EffectComposer`: MSAA target → half-res GTAO → grade pass → optional tilt-shift → `OutputPass`, all lazy-loaded |

- **Dynamic resolution** scales 0.7–1. **Auto-preset** drops one level if p90 exceeds 20 ms
  over the first 3 s.
- **The base look must work without post-processing.**
  - No colour decision may live only in the grade pass: palette changes go in `palette.ts`.
  - GTAO, grade and tilt-shift are High extras. Lazy loading keeps them out of the initial
    JS, which the provisional gate caps at 350 KB gzip.
- **Recommended:** the owner scores the look gates on Medium, the default and without post,
  and glances at Low. The performance gate runs on High. The gates record governs.
- **Shadow radius:** the lighting recipe gives radius 3 and the Medium preset gives radius 2.
  Until D11b settles it by eye, read that as per preset: Medium 2, High 3.
- **Draw calls** (provisional, from the gates): ≤ 150 at Default and ≤ 250 at Far on
  `bench-m4`. One material per chunk combination, and batching by material slot, are how
  the art is meant to stay inside these numbers.

## Pipeline: procedural first

Every mesh starts procedural, behind an `AssetRegistry` slot contract, so hand-made models
can replace pieces later without touching callers. The sketch below is not a type
definition: ADR 0013 and the code own the exact types.

```ts
registry.get(kind, variant, lod) → {
  slots,      // one geometry per material slot (walls, roof, trim, …); palette colours
  anchors,    // smoke, bogie_front, bogie_rear, coupler_f, coupler_r, door (+ sail_hub, windmill)
  footprint,  // ground-contact outline in model space
  budget,     // triangle budget (recommended: a test fails any asset over it)
}
```

- **Model space:** +Y up, origin at ground contact, forward +X, which is sim heading 0 after
  [`coords.ts`](../src/render/coords.ts).
- **The glTF path, later:**
  - Models come from Blender, exported Y-up in metres.
  - Material names equal slot names, and anchors are empties named after the anchors.
  - They load through `GLTFLoader` with meshopt; no Draco.
  - They register against the same `(kind, variant, lod)` keys.
  - The slot's shared Lambert material replaces the file's materials, so colour still comes
    from the palette.
  - Procedural geometry stays as the fallback when a file is missing or fails to load.
- **The lookdev tweak panel** (D11a: only with `?tweak=1`, in any build) edits palette and
  lighting values live and
  exports them to be pasted into `palette.ts` and the lighting module. It never persists
  colours of its own.

## Look gates A and B

Both gates are **owner judgement only**.
- Agents prepare the build, the camera bookmarks, the blank record and a checklist.
- Agents never score, pre-fill, predict, simulate or narrate a verdict.
- The record holds the owner's own words, labelled "owner".
- A look gate is not first-time-player validation, and passing one does not accept M4.

**Rubric:** each criterion is scored 1–5 with a note.

| Criterion | The question |
|---|---|
| Palette | Is it calm and muted, with bright colour only on information? |
| Tiny-diorama charm | Does it read as a lovingly made miniature world with small life in it? |
| Legibility | At Default, can you read track topology, turnout direction and signal aspect and facing at a glance? |
| Cohesion | Does everything belong to one world: one light, one palette, one level of detail? |
| Originality | Does it read as its own game, with nothing traceable to the mood reference's assets, names or UI? |

- **Look Gate A** (D11a, render slice R3):
  - The subject is a static diorama: terrain, light, the scenery kit, buildings and labels,
    plus static track from a scenario snapshot (render slice R2), so legibility can be
    scored.
  - The owner views four camera bookmarks next to the mood board. Recommended bookmarks:
    Default over a station throat with turnouts and signals; Region over the river and a
    viaduct; Close on a village with the church; Far over the whole map.
  - The owner may A/B the pitch at 35.264° against 30°, since pitch is a single constant.
  - If semaphores are not renderable yet, place static models at fixed aspects, or have the
    record state that only track legibility was scored.
- **Look Gate B** (render slice R7, inside the M4 owner walkthrough, D13):
  - The owner reuses the rubric while watching the living diorama.
  - They record a verdict on mood, readability at three zoom levels and construction feel,
    plus any friction.
- **Thresholds:** any pass thresholds are predeclared in the
  [gates record](evidence/m4/2026-09-26-acceptance-gates.md) before the gate runs. This page
  defines only the criteria.
- **Records:** dated files under `docs/evidence/m4/`, each with the SHA, the environment
  (browser, GPU, DPR, preset), the bookmarks, the scores as given, and non-claims.
- Recommended: an originality concern is fixed and the gate re-run, whatever the other scores
  are. The predeclared thresholds govern.

### Look Gate A bookmarks (D11a)

Prepared 2026-09-26 for the owner; **not scored**, and agents never score them. There is no
track in the diorama yet (D3), so these views can support scoring palette, charm, cohesion
and originality, while track legibility waits for static track (see the deviations below).
The gates record's setup is `npm run build && npm run preview`; `npm run dev` shows the same
views. The tweak panel stays hidden unless `?tweak=1` is added. L hides the labels, and Home
returns to the map centre. A blank record to copy on the session
day: [`YYYY-MM-DD-look-gate-a.md`](evidence/m4/YYYY-MM-DD-look-gate-a.md).

| URL | View | Target (world X, Z, m) | ppm | Yaw step |
|---|---|---|---|---|
| `?bookmark=1` | Town close-up: Vējkalni's square and its twin-tower church, at Close | 964.18, −467.47 | 12 | 0 |
| `?bookmark=2` | Forest and river, in the mid band | 1735.00, −455.57 | 4 | 0 |
| `?bookmark=3` | The lake and the windmill, at Region | 640.00, −1255.11 | 2.5 | 0 |
| `?bookmark=4` | The whole diorama, at Far | 998.75, −793.47 | 0.9 | 0 |

- **States are for the golden layout** (terrain `d2ee8189`, scenery `d4aeaa71`, seed
  `baltic-diorama`, 1280 × 720 CSS px checked). The camera looks at the Y = 0 datum, so each
  target sits north of its subject by the ground height ÷ tan(pitch); `bookmarks.ts`
  computes them, and a test pins them.
- **Pitch A/B:** add `&pitch=30` to any bookmark. The subject stays centred (the targets move
  to 964.18, −472.43 · 1735.00, −460.31 · 640.00, −1257.50 · 998.75, −803.93). Without the
  parameter the pitch is the true isometric 35.264°.
- **Viewport:** at 0.9 ppm the whole 2.0 × 1.5 km map spans about 1,798 × 776 CSS px, so
  bookmark 4 shows all of it on a 1920 × 1080 window, and at 1280 × 720 crops about 260 px
  off each of the east and west edges and about 45 px off the south edge (calculated; an
  agent probe put the map corners at screen x −259 to 1,539 and y −11 to 765). With
  `?tweak=1` the tweak panel covers the map's north-east corner at 1920 × 1080.
- **Owner session, 2026-09-26:** partial Look Gate A held on `cd1e628`
  ([record](evidence/m4/2026-09-26-look-gate-a.md)). Legibility waits for static track, and
  the pitch choice waits for Look Gate B.

**Deviations from the gates record's Look Gate A** (the
[gates record](evidence/m4/2026-09-26-acceptance-gates.md#look-gate-a-la-after-d11a-before-d11b)
governs; recorded so the owner can decide whether to hold LA now as a partial gate or amend
the gates record first):
- **Views:** the record's views 1 (Default over a station throat with turnouts and signals)
  and 2 (Region over the river and a viaduct) need D3/D4/D7 track, bridges and signals.
  Bookmarks 2 (forest and river, mid band, 4 ppm) and 3 (lake and windmill, Region) stand in
  for them, and no bookmark is at Default zoom (6 ppm).
- **Presets:** Medium and High don't exist until D11b. The build renders one fixed
  configuration, neither preset: DPR up to 2, a 2,048² `PCFShadowMap` with radius 3,
  default MSAA, no post-processing and the CSS vignette.
- **No static track:** legibility cannot be scored, and the record must say it was not.

## Open items

Each item is recorded here so that it is not silently decided in code. Each is owned by the
slice named.

| Item | Owner slice |
|---|---|
| Shadow radius per preset: 3 (recipe) vs 2 (Medium) | D11b |
| Masonry and structural-steel palette tokens; bridge type over land above 20 m | D4 |
| A palette token for the chain signal's partial aspect; the dot → arm switch-over ppm; the colour-blind overlay values; the minimum ribbon width | D7 |
| Scenery clearing along track corridors (a default since earthworks-lite, 2026-09-27: 5 m, see [Trees and scenery](#trees-and-scenery); buildings still unhandled) | D3/D4 |
| Moiré check on sleepers at Default (blocked until D3 track exists; the per-tree budget was set in D11a: 60–120 / 24–30) | D11a |
| Chimney smoke and shore foam (deferred in D11a: smoke anchors exist, nothing is drawn yet) | D11b (proposed) |
| The sun's screen direction: D1's sun casts shadows right and slightly up the screen, while this page says lower right | Look Gate A (owner) |
| Camera pitch: true isometric 35.264° or 30° (the owner deferred the choice at Look Gate A, 2026-09-26) | Look Gate B (owner) |

## Terrain look variants (2026-09-27)

**Status (2026-09-27, agent):** built on branch `codex/terrain-crisp-look` at `31bc24f`, from
the D3 branch at `c699393`, for the owner to compare side by side. **Not judged:** the owner
decides which variant, if any, becomes the look, and nothing here is a Look Gate result. The
sections above are unchanged, including "Smooth shading for terrain" under
[Materials](#materials), which variant `b` departs from (see the recommendation).

**Owner feedback (2026-09-27, as relayed to the implementing agent):** asked what was off,
the owner chose "Terrain too blurry/flat: The ground reads as soft green blotches; needs more
crispness or lattice/field detail." Their screenshot was at about Region zoom over open
grassland.

**Diagnosis** (automated probes on the golden terrain, and agent captures):
- **The relief is gentle.** Land spans 10.5–39.6 m; over its 132,550 nodes the slope has a
  median of 3.6°, a 90th percentile of 7.5° and a maximum of 32.6°. Under the 42° sun and
  the 1.1 hemisphere fill, a 3.6° slope moves the lit colour by roughly ±5% (calculated).
  D11a's 70 m grass patches span grass shade → light, which is far more. So the patches read
  and the hills don't.
- **Nothing on the grass is crisper than 5 m.** Every D11a grass variation is baked per
  lattice node and interpolated across the 5 m triangles.
- **Splat edges blur at Default and Close.** The splat is bilinear at 1 m per texel, which is
  6–12 px there (calculated).
- **Two dead ends shaped the variants** (agent captures). Steepening the lighting alone turns
  the Int16 heights' 1 dm steps into streaks along the lattice rows. Deepening the baked
  hollow tint draws the map's small pits as dark blobs.

**The variants.** Pick one with `?terrain=`, which combines with `?bookmark=1..4` and
`&pitch=30`. With no parameter (or an unknown value) the page shows the recommended default,
`b`. Code: [`terrain/terrainLook.ts`](../src/render/terrain/terrainLook.ts).

| URL | Variant | What it adds |
|---|---|---|
| `?terrain=d11a` | D11a | nothing: the look Look Gate A scored, bit-identical (the splat GLSL, baked colours and normals were checked against `c699393`) |
| `?terrain=a` | Crisp relief | slope gain on smooth normals, a calmer bake, crisp grass detail, crisp splat edges, 8× anisotropic filtering of the splat and AO maps |
| `?terrain=b` | Faceted (default) | `a`, plus each lattice triangle lit as a facet from Region zoom in, and the tone patches at 70% |
| `?terrain=c` | Contour hint | `b`, plus a faint line every 2.5 m of height |

So `a` → `b` isolates the facets and `b` → `c` the contours. The ingredients:
- **Slope gain** ([`relief.ts`](../src/render/art/shaderChunks/relief.ts)). The shading
  normal's slope tangent t becomes t·5 / (1 + t·5), keeping its aspect, so gentle slopes
  light about five times as steep and none passes 45°. The median 3.6° slope is lit as
  13.5°. Flat ground keeps its exact colour. The normals come from heights smoothed twice
  (a six-neighbour binomial filter), which removes the streaks; only shading uses them.
- **Calmer bake.** The 70 m patches are at a quarter and the per-node jitter is gone. The soft
  meadow on the highest ground drops to 0.15, because the flecks below replace it.
- **Crisp grass detail** ([`groundDetail.ts`](../src/render/art/shaderChunks/groundDetail.ts)),
  run by the splat on the grass before fields, roads, cobbles and forest floor are laid, so
  none of it shows through them. Every cut is antialiased with `fwidth`:
  - tone patches: 16 m noise broken up at 5 m, cut into lighter grass (18% toward grass
    light) and darker grass (12% toward grass shade);
  - static-grass tufts: dots about 0.5 m across in 35% of 1.6 m cells, fading out before they
    shrink under 2 px;
  - meadow flecks that grow denser from 22 m up to 34 m of height, so hilltops read by colour
    too;
  - soil on slopes steeper than 17–32° (noise picks the angle), so steep banks fray;
  - a wet, darker soil line up to 0.25–0.45 m above the water, so shores end crisply.
- **Crisp splat edges.** Fields and cobbles are cut at weight 0.5. Roads and yards are cut at
  0.45 and keep their weight past it (yards stay at 0.55). The forest floor's edge frays with
  a 4 m noise.
- **Facets** (`b`, `c`). Each triangle's own plane normal, from screen derivatives of the
  world position, is added on top of the steepened smooth normal (weight 2.5). It fades in
  between 1.5 and 2.5 ppm, so Far and the 10 m LOD stay smooth.
- **Contour hint** (`c`). The lines are one pixel wide at any zoom, every fourth (10 m) is
  1.6× stronger, and they fade out where lines would crowd under 4 px apart.

Colours come only from existing tokens (grass, grass light, grass shade, meadow, soil), so the
palette table is unchanged and **no token was added**. Lighting, water, trees, buildings and
props are untouched. Terrain generation, the mesh, picking and the sim are untouched too. The
only per-frame work is one uniform write (the zoom).

**Agent observations** (headless Chrome through Playwright, 1280 × 800 at DPR 1, Apple M5 Pro,
ANGLE Metal; `CAPTURE=1 npx playwright test --project=capture`, images in the gitignored
`test-results/terrain-look/<variant>/`). These are agent notes on the captures, not a look
verdict:
- **Region, open grassland** (`grassland-region`). D11a is the soft 70 m mottle the owner
  described. In `a`–`c` the broad light and dark areas follow the hills, with crisp tone
  patches and meadow flecks on top. `b` adds a fine triangle grain.
- **Far** (`bookmark-4`, `grassland-far`). The blotches give way to landforms: the lake's
  bowl, the river valley and the hills. River banks show sparse soil patches. `c`'s contours
  are faint at this zoom.
- **Default and Close** (`grassland-default`, `hill-*`, `bookmark-1`). `a` shows calm
  two-tone patches and tufts. `b`'s facets read as a hand-cut low-poly ground that matches
  the flat-shaded trees and roofs. The cobble square's edge is crisp, and the town close-up
  is otherwise unchanged.
- **Track over a hill** (`track-hill-*`, a 36-step run laid with the real track tool). The
  hill rises 7.7 m over about 120 m, then drops 11.8 m over about 60 m to the lake. The
  steep side now reads as a lit or shaded slope (faceted in `b` and `c`), but the gentle
  climb still reads only modestly. `c`'s contours give the clearest height cue.
- **Build mode** (`track-hill-build`): the lattice overlay draws exactly as in D11a, and in
  `b` the facets coincide with its triangles.
- **One yaw step** (`hill-default-yaw1`): the relief turns with the sun, and the detail stays
  anchored to the ground.
- No page errors or warnings in any run.

**Frame cost** (agent development readings on the machine above; never cite them against the
[acceptance gates](evidence/m4/2026-09-26-acceptance-gates.md), where only D13 runs count).
Each figure is the mean ms per frame over 60 back-to-back renders closed by one 1-pixel
`readPixels`, after 120 warm-up renders. Draw calls and programs are the same in every
variant. The 2560 × 1600 viewport stands in for DPR 2: headless Chrome kept the canvas at its
CSS size with `deviceScaleFactor: 2`.

| View | D11a | a | b | c | Draw calls |
|---|---|---|---|---|---|
| Region grassland, 1280 × 800 | 0.44 | 0.72 | 0.77 | 0.77 | 114 |
| Bookmark 3 (Region), 1280 × 800 | 0.47 | 0.65 | 0.66 | 0.68 | 117 |
| Bookmark 4 (Far), 1280 × 800 | 0.72 | 0.99 | 1.00 | 1.01 | 120 |
| Region grassland, 2560 × 1600 | 1.39 | 2.15 | 2.21 | 2.21 | 247 |

- Across all captured views the variants add 0.08–0.33 ms per frame at 1280 × 800 and
  0.36–0.82 ms at 2560 × 1600; the Region grassland is the dearest view.
- A layer ablation at `31bc24f` (2560 × 1600, Region grassland, two runs that agreed within
  0.03 ms) split `b`'s +0.79–0.81 ms as follows:
  - tufts 0.13–0.14 and tone patches 0.12–0.14;
  - flecks, soil and waterline 0.27–0.28, including the shared 5 m noise they then no longer
    need;
  - facets and anisotropic filtering about 0;
  - 0.25–0.26 for the rest: the crisp splat cuts and fray noise, and the relief maths.
- Each detail layer sits behind a uniform branch, so a zero amount costs nothing. D11b's
  presets can drop layers without new programs.
- The initial JS grew from 274.49 to 278.02 kB gzip.
- `EXT_disjoint_timer_query_webgl2` is exposed, but its readings exceeded the synchronous
  frame time, so GPU times are "n/a".

**Recommendation (agent; the owner decides): `b`, the default.**
- **Crispest at Default and Close.** Its facets are the lattice itself, the "lattice detail"
  the feedback names. They line up with the build-mode overlay and share the flat-shaded
  facets of the trees, roofs and rocks.
- **Hills read at Far and Region**, through the slope gain it shares with `a`.
- **Palette untouched.** No token added, and flat ground keeps its D11a colour.
- **Facets measured at about 0 cost** over `a`.
- **Against it:** it departs from "Smooth shading for terrain" (Materials above), which
  needs a dated amendment if the owner keeps it. Its facets also carry the 1 dm height steps'
  irregularity.
- **`c`** is the strongest cue for laying track over hills. But the lines read like a map,
  something no physical diorama has. A build-mode-only contour hint is a possible middle
  ground (not built).
- **`a`** is the most conservative step from D11a.

**Open (not established here):**
- The owner's choice. After it, the losing variants go or become presets, and the chosen
  look's rationale joins the sections above in a dated amendment.
- Legibility was not assessed. The mid laptop, real DPR 2 and the Low preset are unmeasured.
- Whether the owner reads the relief as hills and the detail as calm.

## Terrain look: the owner's choice (2026-09-27)

**Label: owner.** On 2026-09-27 the owner compared `?terrain=d11a`, `a`, `b` and `c` on a
local preview of `codex/terrain-crisp-look` at `3e8a8d3`, served by an agent, without
earthworks. Asked which look should become the default, the owner chose **"b: faceted"**:
"Crisp relief + low-poly lattice facets from Region zoom in (the agent's recommendation).
Needs a dated art-direction amendment ('smooth shading for terrain')."

- **Amendment to Materials.** Above, "**Smooth shading** for terrain" is left as written; this
  note supersedes it. From Region zoom in, the terrain's lattice triangles are lit as flat
  facets. At Far they stay smooth.
- **Default.** `b` is the default (`DEFAULT_TERRAIN_LOOK` in
  [`terrainLook.ts`](../src/render/terrain/terrainLook.ts)). `d11a`, `a` and `c` stay
  selectable through `?terrain=` for comparison, until D11b decides whether they become
  presets or go.
- **Not established:**
  - Look Gate A's legibility score, which is still pending;
  - how `b` reads together with earthworks, since the owner chose without them;
  - the cost on the mid laptop and at real DPR 2.

## Render pass iteration (2026-09-27)

**Status (2026-09-27, agent):** built on branch `codex/render-earthworks-terrain`, code at
`b864b05` (from `329b69a`, draft PR [#83](https://github.com/Kminkjan/infrastructurio/pull/83)).
**Not judged:** the owner reads the result, and nothing here is a Look Gate result. The
sections above stay as written. This section supersedes the earthworks-lite shading bullets
under [Terrain and water](#terrain-and-water) and the earthworks-lite token roles under
[Palette](#palette), and it amends look `b`'s parameters in
[Terrain look variants](#terrain-look-variants-2026-09-27). The geometry numbers are in the
[ADR 0010 finding](decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-27-render-pass-iteration)
and the shader and cost notes in the
[ADR 0013 finding](decisions/0013-rendering-and-art-pipeline.md#findings-2026-09-27-render-pass-iteration).

**Owner feedback (2026-09-27, as relayed to the implementing agent).** Looking at a Close-zoom
screenshot of a curve that crosses a hill in a cutting and then runs on an embankment down
toward a lake shore, over look `b`, the owner picked "Facets too strong/noisy" and wrote:
"The groundwork/dirt seems very pixely", then "Still a bit wonky".

The relaying agent's notes on the screenshot (its description, not the owner's words):
- sawtooth crests, daylight lines and colour edges along the 1.25 m refined triangles;
- stepped vertical faces where the fill meets the shore;
- large bare brown areas on the fill and the cut faces;
- noisy ground: facet bands, hard-edged yellowish patches, flecks.

The goals it set: the track never hidden; earthworks that read as smooth, deliberate miniature
landforms at Close, Default and Region; and ground that is crisp but calm.

**What changed** (code: [`earthworks.ts`](../src/render/terrain/earthworks.ts),
[`earthworkMesh.ts`](../src/render/terrain/earthworkMesh.ts),
[`shaderChunks/earthwork.ts`](../src/render/art/shaderChunks/earthwork.ts),
[`terrainLook.ts`](../src/render/terrain/terrainLook.ts)):
- **Rounded landforms.** The side slope eases into 1 : 1.5 over 2 m past the formation edge,
  and meets natural ground through a smooth clamp over 0.6 m of height (about 1.8 m of plan
  on flat ground), instead of at two kinks. The 5 cm "leave natural" step became a soft band
  from 5 to 10 cm. The formation is still flat to 3 m, so the track stays clear.
- **Smooth shading and colour edges.** A moved vertex takes the smooth natural normal, tilted by
  the gradient of how far the ground moved. So the relief's slope gain no longer magnifies
  triangle noise along the lip. The colour weight is a ramp of an unclamped potential, how far
  the natural ground lies outside the cut and fill envelopes. It interpolates exactly across
  the triangles, and the shader cuts it per fragment, so no colour edge follows a triangle.
  The facets fade out over the refined lip.
- **No cliffs at the water.** Fills continue their slope under the water, where the opaque
  water plane hides them, instead of stopping on a shelf 10 cm under it. Made ground takes the
  land colour without the shore soil tint, never the underwater bed's. A bank reaches the
  water grassed, down to the ground detail's thin wet line.
- **Grassed banks.** Earthworks keep the surrounding grass and its detail. Fields, roads,
  forest floor, the AO tint and the slope soil fade out on them. Steep earthwork slopes move
  12% toward grass light. `earthworkFace` (at most 85%) shows only in cuts deeper than about
  1.5 m (fading in from 1.2 to 2.2 m of cut), and only on their lower batter, up to about 2 m
  above the formation (fading out from 1.5 to 2.5 m). So a deep cutting reads as a fresh lower
  face under a grassed upper slope, however deep it is. `earthworkBed` is a shoulder
  2.4 → 3.0 m from the centreline where the formation is cut, merging into that face.
  Embankment tops stay grassed up to the ballast. Two variants were rejected on agent
  captures: a shoulder on fills (it drew a thin detached line on the fill side of
  cross-slopes), and a steepness gate on the bare earth (it drew a thin line on short
  downhill cut faces).
- **Palette.** No token was added or changed. `earthworkFace` and `earthworkBed` keep their
  values in the narrower roles above; the banks use `grass` and `grassLight`.
- **Calmer ground (look `b`, still the default).** Look `a` keeps its values exactly.

| Look `b` setting | Before (the owner's pick, `3e8a8d3`) | After |
|---|---|---|
| Facet weight (fade 1.5–2.5 ppm) | 2.5 | 0.8 |
| Slope gain, levelling tangent | 5, 1 | 5, 1 (unchanged: the hills keep reading) |
| Tone patch amount, cell | 0.7, 16 m | 1, 26 m |
| Patch mix toward grass light / shade (effective) | 0.18 / 0.12 at 70%: 0.126 / 0.084 | 0.08 / 0.07 |
| Patch and fleck edge | one pixel | a soft cut of ±0.08 noise units: median ±3.5 m for patches, ±1.9 m for flecks (measured on the noise mirror) |
| Meadow flecks: amount, cut levels | 1, 0.95 → 0.72 | 0.5, 0.97 → 0.80 |
| Tufts (share of 1.6 m cells) | 0.35 | 0.2 |
| Slope soil, waterline | 1, 1 | 1, 1 (the slope soil is masked on earthworks) |

**Agent observations** (headless Chrome through Playwright 1.63.0, 1280 × 800 at DPR 1, Apple
M5 Pro, ANGLE Metal; `CAPTURE=1 RENDER_ITER_LABEL=<label> npx playwright test
--project=capture renderIter`, images in the gitignored `test-results/render-iter/before/`
from `329b69a` and `after/` from `b864b05`). The owner's scene was laid with the real pointer:
a drag (50, 203) → (34, 246) on the lake's east shore gives ten straights, then an R 180 curve
cutting up to 5.3 m into a hill flank and ending on a fill of up to 2.4 m at the shore. These
are agent notes, not a look verdict:
- **Close** (`curve-close`, `cutting-close`, `shore-close`, `shore-zoom` at 24 ppm):
  - *before*: stair-stepped crests and colour edges about 15 px apart, brown faces and bed,
    diagonal facet bands, hard-edged yellowish flecks;
  - *after*: smooth rounded lips, grassed faces with a brown lower batter and a narrow
    shoulder along the cut, and calm grass with faint facets. In a 2× crop the stair-steps
    are gone, but a faint, soft ripple remains in the shading of the outer lip on the shadowed
    side. At the shore, the bank runs into the water as a slope.
  - The track's end sits 10 cm above the water, so the rounded nose around it lies inside the
    waterline detail's wet band and reads brown, like the natural shore rim.
- **Default and Region** (`curve-default`, `curve-region`): the cutting reads as a soft
  light-and-shade groove with thin brown bands at Default. At Region it is a subtle groove
  rather than round 1's brown leaf, and the track stays visible. The tone patches no longer
  read as blotches.
- **One yaw step** (`curve-close-yaw1`): the relief turns with the sun and the banks stay smooth.
- **Bookmarks 1–4** (`bookmark-*`): the town, the river and the far view are unchanged except
  for calmer grass tones.
- **Regression scenes** (`test-results/earthworks/after-*`: the round-1 hill curve, a
  cross-slope straight, Far through Close): no stair-steps, and the 10 m cut shows a brown
  lower batter under a grassed face.
- No page errors or warnings in any run.

**Open (not established here):** how the owner reads any of this; Look Gates A and B;
legibility; the mid laptop, real DPR 2 and the Low preset. The soft patch edges (median
±3.5 m) risk drifting back toward the soft blotches the owner found "too blurry/flat" before
look `b`; their contrast is low (8% and 7%), and the tufts and relief carry the crispness.
Whether cut faces should show earth at all, and whether embankment tops should show a shoulder,
are open to the owner.
