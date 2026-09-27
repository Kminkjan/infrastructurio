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

| Group | Colours |
|---|---|
| grass | `#8FA66B`, light `#A9BA7E`, shade `#6E8752`, meadow `#C2BE7C` |
| forest | spruce `#3F5A3C`/`#4F6B45`, pine crown `#5A7048`, deciduous `#7E9A4F`/`#93A85A`, birch trunk `#E8E2D0` |
| ground | soil `#A88F6A`, dirt road `#B8A07A`, cobbles `#A39C90`/`#8E877B`, rock `#9A9486`, forest floor `#71704F` (D11a, in-house) |
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
| Scenery clearing along track corridors | D3/D4 |
| Moiré check on sleepers at Default (blocked until D3 track exists; the per-tree budget was set in D11a: 60–120 / 24–30) | D11a |
| Chimney smoke and shore foam (deferred in D11a: smoke anchors exist, nothing is drawn yet) | D11b (proposed) |
| The sun's screen direction: D1's sun casts shadows right and slightly up the screen, while this page says lower right | Look Gate A (owner) |
| Camera pitch: true isometric 35.264° or 30° (the owner deferred the choice at Look Gate A, 2026-09-26) | Look Gate B (owner) |
