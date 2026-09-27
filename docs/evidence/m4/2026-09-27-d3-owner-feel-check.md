# D3 owner feel check: 2026-09-27

**Label: owner.** The owner gave the answers below on 2026-09-27 in conversation, by answering
explicit questions. An agent transcribed them verbatim:
- where the owner picked an option, the record gives its label plus that option's description;
- where the owner typed text, it is quoted exactly, typos included.

Nothing was pre-filled or predicted. Agent observations are kept out of the owner's answers and
marked as such.

Governing item: [#67](https://github.com/Kminkjan/infrastructurio/issues/67) acceptance
criterion "**(owner)** Early owner feel check: the owner tries the tool, and their verdict is
recorded as owner evidence". PR: [#82](https://github.com/Kminkjan/infrastructurio/pull/82).

## Setup (both sessions)

- An agent served the build with `npx vite --host 127.0.0.1 --port 5233 --strictPort` from a
  detached worktree (`../infrastructurio-wt/d3-feel`). The owner opened `http://127.0.0.1:5233/`.
- Machine, OS, browser, DPR, viewport and session length were not reported by the owner.
- **Controls given to the owner:**
  - `1` selects Track;
  - drag, or click then click, to lay track, and a further click chains;
  - ⌥ for precision (wheel for the radius, Q/E for the end heading);
  - `[` `]` or PgUp/PgDn for height;
  - Cmd+Z / Cmd+Shift+Z to undo and redo;
  - Esc steps back;
  - right-drag pans, the wheel zooms, and Q/E rotate the camera.

## Session 1: build `20a682f`

The D3 tool with the 15 code-review fixes and height pinning.

- **Question:** "How does construction feel?"
- **Owner's answer** (typed): "It feel quite good, but tracks are often "under the ground".
  Check te screen open right now. Also chained drags feel okay but they cannot turn more then
  90 degrees right?"
- **Agent note:** the agent could not see the owner's screen; this session is not permitted to
  capture it. The agent reproduced the report numerically instead. With ground-height ends
  and straight-line interiors, 24% of track nodes lay more than 1 m below the terrain on the
  diorama map.
- **Follow-up decisions (owner):**
  - **Track height:** "Follow the ground now (Recommended)": "In D3, track sits on the
    terrain at every node (plus a small visual lift so hump-crossings between nodes don't hide
    rails). [ ] still raise/lower. D4 later brings the 35‰ rule together with earthworks,
    bridges and tunnels and revisits this."
  - **Turns:**
    - The owner first asked (typed): "What is industry best practice?"
    - After the agent's summary, the owner chose "Yes, two bends up to 180° (Recommended)":
      "When no single bend reaches the pointer, the planner fits two curves in one drag
      (hairpins, U-turns). Added to D3 before merge, after the ground-following fix lands."
- **Merge approval (owner):** "Approve after feel check (Recommended)": "I merge #82 only once
  the feel check is recorded as a pass, so any friction can be fixed first."

## Session 2: build `0255a48`

Ground following ([ADR 0010 finding](../../decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-27-d3-ground-following))
and two-bend free drags ([ADR 0010 finding](../../decisions/0010-triangular-lattice-track-geometry.md#findings-2026-09-27-d3-two-bend-free-drags))
added.

- **Question:** "How does construction feel now?"
- **Verdict (owner):** "Feels good: pass": "Recorded as owner evidence (pass) on #67; I then
  merge #82 per your approval."
- **Lattice kinks (owner):** "Prefer one bend, a node off (Recommended)": "Only use two bends
  when no single bend lands within ~1 node of the pointer; smoother track, end sits up to ~5 m
  from the cursor." This preference lands in a commit after `0255a48`, so the owner has not
  tried it.
- **Related owner remark in the same sitting** (typed, with a screenshot that is not
  committed): "Rendering is not yet "there"".
  - **Agent reading of the screenshot:**
    - curves vanish where they pass under rising ground (a curve is one piece with one
      grade);
    - at that zoom the track reads as a thin, faint line.
  - This bears on Look Gate A's pending legibility score. It is not scored here.

## Non-claims

- This records the owner's construction feel on two builds. It is not first-time-player
  validation, not Look Gate A's legibility score, and not M4 acceptance.
- It says nothing about rendering quality beyond the owner's remark above.
- The kink preference and any later rendering changes were not felt by the owner in these
  sessions.
