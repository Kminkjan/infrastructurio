# Look Gate A (LA): 2026-09-26 session (partial)

**Label: owner.** The owner gave the scores, choices and verdict below on 2026-09-26 by
answering explicit questions in conversation. An agent transcribed them here verbatim: each
answer is the option label the owner chose, plus that option's description. Nothing was
pre-filled or predicted, and agent observations are not part of this record.

Governing protocol: [acceptance gates, Look Gate A](2026-09-26-acceptance-gates.md#look-gate-a-la-after-d11a-before-d11b)
(rubric and pass rule there). Views and deviations:
[art direction, Look Gate A bookmarks](../../art-direction.md#look-gate-a-bookmarks-d11a).
Blank template: [`YYYY-MM-DD-look-gate-a.md`](YYYY-MM-DD-look-gate-a.md).

## Record header

- **Date:** 2026-09-26
- **Label:** owner
- **Build under test:** `cd1e628a393b47c663f78f3371e3795f0ba82feb` (branch
  `codex/d11a-lookdev`, PR [#81](https://github.com/Kminkjan/infrastructurio/pull/81)), clean
  tree. Served by an agent with `npx vite --host 127.0.0.1 --port 5231 --strictPort` from
  the D11a worktree; the owner opened `http://127.0.0.1:5231/?bookmark=1` to `4`.
- **Gates file blob SHA:** `897942085f4713bb541529569e3f927dd4a14380`. That is the approved
  gates record ([#79](https://github.com/Kminkjan/infrastructurio/pull/79)).
- **Environment:**
  - machine, OS, browser, DPR, viewport and session length: not reported by the owner;
  - preset: none exists before D11b; the build renders one fixed configuration (see
    deviations).

## Views

| # | URL | View | Target (world X, Z, m) | ppm |
|---|---|---|---|---|
| 1 | `?bookmark=1` | Town close-up (Vējkalni and its church), Close | 964.18, −467.47 | 12 |
| 2 | `?bookmark=2` | Forest and river, mid band | 1735.00, −455.57 | 4 |
| 3 | `?bookmark=3` | Lake and windmill, Region | 640.00, −1255.11 | 2.5 |
| 4 | `?bookmark=4` | Whole diorama, Far | 998.75, −793.47 | 0.9 |

- **Pitch choice (owner):** "Decide later". The A/B switch (`&pitch=30`) stays available,
  and the choice is made at Look Gate B. The pitch stays the true isometric 35.264° until
  then; ADR 0009 is unchanged.

## Deviations from the gates record

- **Gate form (owner):** "Score now, legibility later". Palette, charm, cohesion and
  originality are scored now from the four views. Legibility is scored once static track
  exists (D3), in a follow-up record. This is a partial gate.
- **Views:** there is no Default view over a station throat and no Region view over a
  viaduct; both need D3, D4 and D7. Bookmarks 2 and 3 stand in for them.
- **Presets:** there is no Medium or High preset (D11b). The build renders one fixed
  configuration: DPR up to 2, a 2,048² `PCFShadowMap` with radius 3, default MSAA, no
  post-processing, and the CSS vignette.
- **No static track:** legibility was not scored.

## Rubric (owner)

| Criterion | Score | Reason (owner's chosen answer) |
|---|---|---|
| Palette | 5 | "5 — exactly right": "Calm, muted, cohesive; nothing to change." |
| Tiny-diorama charm | 5 | "5 — exactly right": "Reads as a lovingly made miniature." |
| Legibility | not scored | Deferred until static track exists (D3); see deviations |
| Cohesion | 5 | "5 — exactly right": "One world throughout." |
| Originality | 4 | "4 — mostly own": "Own game, with a faint resemblance in places." |

- **Overall verdict (owner):** "Pass (partial: legibility pending)". Palette, charm, cohesion
  and originality pass. Legibility is scored after D3 in a follow-up record.
- **Pass rule check** (gates record: verdict "pass" and every item ≥ 3): met for the four
  scored items. Legibility is pending, so the gate is partial.
- **Originality concerns named (owner):** "Nothing specific": a general genre resemblance,
  no issue needed. No issue was filed.
- **Related owner decision in the same session** (outside the rubric): the railway set
  pieces the scenario placed beside Vējkalni (a station, water tower and engine shed) are
  to be **removed now**. Stations and depots are player-built (D6). That removal lands in a
  commit after this build, so it was not part of what was scored.

## Non-claims

- This record is the owner's judgement of a static diorama build. It is not
  first-time-player validation, and it does not decide M4; Look Gate B and the walkthrough
  do (D13).
- Legibility is unscored, so this is a partial Look Gate A. The follow-up record after D3
  completes it.
- Agent observations are not part of this record.
