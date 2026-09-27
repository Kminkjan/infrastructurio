# Look Gate A (LA): blank record template

**This file is a template, not a record.** On the session day, copy it to
`docs/evidence/m4/<YYYY-MM-DD>-look-gate-a.md` (the session's start date), fill in the copy,
and leave this template as it is. Agents prepared the template (D11a,
[#75](https://github.com/Kminkjan/infrastructurio/issues/75)); preparation is not acceptance.
Only the owner writes scores, notes and the verdict. Nothing below is pre-filled beyond the
build instructions and the prepared views.

Governing protocol: [acceptance gates, Look Gate A](2026-09-26-acceptance-gates.md#look-gate-a-la-after-d11a-before-d11b)
(rubric and pass rule there). Views and deviations:
[art direction, Look Gate A bookmarks](../../art-direction.md#look-gate-a-bookmarks-d11a).

## Record header

- **Date:**
- **Label:** owner
- **Build under test (40-character SHA, clean tree):**
- **Gates file blob SHA** (`git rev-parse HEAD:docs/evidence/m4/2026-09-26-acceptance-gates.md`):
- **Commands:** `npm ci`, then `npm run build && npm run preview` (or `npm run dev`); open the exact URL the command prints.
- **Environment:**
  - machine and OS:
  - Node:
  - browser and version:
  - preset: none exists before D11b; the build renders one fixed configuration (see
    deviations)
  - DPR:
  - viewport (CSS px):
- **Session length:**

## Views

Add `&pitch=30` to a URL for the 30° half of the pitch A/B. The mood board is art
direction's [public-domain mood sources](../../art-direction.md#public-domain-mood-sources).

| # | URL | View | Target (world X, Z, m) | ppm | Yaw step | Seen at 35.264° | Seen at 30° |
|---|---|---|---|---|---|---|---|
| 1 | `?bookmark=1` | Town close-up (Vējkalni and its church), Close | 964.18, −467.47 | 12 | 0 | | |
| 2 | `?bookmark=2` | Forest and river, mid band | 1735.00, −455.57 | 4 | 0 | | |
| 3 | `?bookmark=3` | Lake and windmill, Region | 640.00, −1255.11 | 2.5 | 0 | | |
| 4 | `?bookmark=4` | Whole diorama, Far | 998.75, −793.47 | 0.9 | 0 | | |

- **Pitch choice (owner):**

## Deviations from the gates record

Prepared by agents from art direction; the owner confirms or amends each one, and decides
whether LA is held now as a partial gate or after amending the gates record.
- **Views:** no Default-zoom view over a station throat, and no Region view over a viaduct
  (both need D3/D4/D7). Bookmarks 2 and 3 stand in for them.
- **Presets:** no Medium or High preset (D11b). One fixed configuration: DPR up to 2, a
  2,048² `PCFShadowMap` with radius 3, default MSAA, no post-processing, the CSS vignette.
- **No static track:** legibility was not scored.
- **Other (owner):**

## Rubric (owner)

Scores 1–5, in the owner's own words. The pass rule is in the gates record.

| Criterion | Score | Reason (owner) |
|---|---|---|
| Palette | | |
| Tiny-diorama charm | | |
| Legibility | | |
| Cohesion | | |
| Originality | | |

- **Overall verdict (owner):**
- **Originality concerns named (each filed as an issue):**
- **Notes (owner, verbatim):**

## Non-claims

- This record is the owner's judgement of a static diorama build; it is not first-time-player
  validation, and it does not decide M4 (Look Gate B and the walkthrough do).
- Agent observations are not part of this record.
- Other (owner):
