# M4 independent evidence review — 2026-09-06

Reviewed in a fresh isolated worktree after fetching `origin/main` at
`b57f0b37964cf4481132f73dd6873eb830cc881d` (PR #47). Ancestor checks confirm PR #46
`db4dc50dd87944b7ee98d70472de11864cf974f3` and documentation PR #45
`de77568257d22949684b9e4298947d755c11646e`. Read milestone 5, epic #21, #26–#28,
#13–#20 and merged PR bodies/comments/reviews. All research and legacy issues remain
open; PR #46/#47 have no submitted GitHub reviews. This is an agent source/evidence
review, not a human construction comparison or production acceptance.

## #27: reproduced, bounded conclusions supported

Ran `npm run research:m4:lanes -- /tmp/m4-lane-review.json` and the five behavioral
checks. [Independent raw rerun](lane-review-results.json) preserves the new hardware,
timings and baseline without replacing the original report. Deep equality holds
for all `comparisons`, `units`, `bounds` and `sourceHashes` against
[lane-results.json](lane-results.json).

Source inspection confirms old-position following, one conflict reservation until
the full token clears, exit blockage propagating upstream, pending request timestamps,
partial batch flushing and per-tick conservation. Changing priority only reallocates
service: saturated weight-1 completions remain 224/0 versus 64/160. Weights 2/4
conserve trips but fail declared outcome bounds. No lane-model correctness defect
was found within those claims. The conclusion remains rejection of this spatial
batching scheme, not rejection of every possible representation scheme.

Five reruns on Apple M5 Pro / 48 GiB / Node v26.7.0 reproduce 2,144 peak active
vehicles, 14,320 peak pending requests and 90,049-byte sampled snapshots across
32 disconnected junctions / 128 directional lanes. Per-repeat p95 ranges:

| Operation | Rerun p95 range |
| --- | ---: |
| One movement tick | 0.0188–0.0470 ms |
| Ten-tick batch | 0.1762–0.2568 ms |
| Snapshot construction | 0.0861–0.1829 ms |
| JSON serialization | 0.0660–0.1063 ms |

Worst individual tick was 2.8175 ms. The p95 guardrails still pass; they are not
worst-case latency guarantees. Timing equality is neither expected nor required.
Cell speed and conservative reservation release are coarse research assumptions;
there is no connected-region routing, signal/merge model, browser scheduler or
production persistence proof. Keep #27 open for explicit acceptance disposition.

Recheck deterministic reproduction after another run with:

```sh
node --input-type=module <<'JS'
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const original = JSON.parse(readFileSync('docs/research/m4/lane-results.json'));
const rerun = JSON.parse(readFileSync('/tmp/m4-lane-review.json'));
for (const key of ['comparisons', 'units', 'bounds', 'sourceHashes'])
  assert.deepEqual(rerun[key], original[key], key);
JS
```

## #26: source, screenshot and raw-data review

Inspected both adapters, shared scene/controller, runner and camera use; visually
reviewed both curve, lane, raised-deck and filtered-queue screenshots. The selected
states, matching S-curve and filtered queue explanations support the documented
scripted outcomes. The oblique deck has visible thickness/support cues, but these
images do not show that people understand height better. The shared geometry is
isolated; the original application does not gain those controls. Stress motion is
sinusoidal icon translation, not physical traffic. Pixi per-icon Graphics and
Three.js instancing explain why CPU costs cannot rank engines generally.

The committed report passes independent recomputation of every frame/CPU summary
and draw/reshape error from its raw data. The reported 9.2–9.3 ms p95 frame range
and implementation-specific CPU measurements are supported. The verifier previously
accepted an empty hash manifest, duplicated renderer/workload runs, altered timing
summaries and mutually agreeing wrong expected/actual selections. It now requires
the full source manifest, one run per renderer, unique tasks and workload/repeat
coverage, fixed expected targets, coordinate recomputation, and raw-derived timing
summaries. Ten checks exercise valid evidence and nine corrupted-report cases.
The measured source files and original raw results are unchanged.

Two coverage claims need qualification: visibility is sampled only at the end of
each window; edit-rebuild CPU has no committed raw series, only its summary. The
verifier cannot independently certify uninterrupted foreground visibility or that
rebuild distribution. Documentation now states both limits. It still cannot certify
GPU time, human precision/discoverability, accessibility, or an integrated region.

A fresh browser timing run was **not performed** in this review. Starting Vite with
`--strictPort` found port 5173 already occupied; the runner hardcodes that port.
Do not run it against an unidentified server: it hashes local files, not the files
served by that process. Reproduction instructions now require strict-port startup
from the intended checkout. The existing server was left untouched. This does not
block review of committed evidence, and no new browser timings are claimed.

## #28: independent audit work completed; final gate pending

[Legacy inventory](legacy-inventory.md) now records source-backed layer ownership,
the exact shared IndexedDB slot, and the resulting non-overwrite constraint. Both
legacy versions write `infrastructurio` / `saved-games` / `m0-scenario`; a new valid
payload could overwrite a legacy save on the same origin. New scenario storage
must be separate before writes, and retaining a git branch does not provide a
usable legacy launcher. Actual legacy access and v3/v9 non-overwrite testing remain
#38 work. No save data was opened or migrated.

Architecture, simulation and performance notes now reflect both bounded ADRs and
separate movement/browser envelopes. They do not select production cadence,
worker migration, renderer/camera or integrated region budgets. #13–#20 mappings
remain valid candidates with their issues open; M3 code inspection is not a fresh
M3 release test. #26 human comparison and production decision, #27 acceptance
and #28 final migration acceptance remain pending. Epic #21 and milestone 5 stay open.

## Checks and preservation

`npm ci`, 73 application Vitest tests, 15 Node research checks, the strengthened
rendering verifier, TypeScript/production build and `git diff --check` pass.
No production files changed. Original checkout remains at `18dc5ee` on
`codex/issue-19-release-gate`, with ten modified files and binary diff SHA-256
`42c4eec5ee1290dd8fbfd62cac7edccce0bf23b53579a12dff50c7877b993841`.

## Subsequent disposition

The [formal acceptance assessment](acceptance-disposition.md) now maps #27's four
criteria to the reviewed evidence and recommends closure of that bounded research
issue. The [v2 workflow](rendering/human-comparison.md) fixes the runner limitations
identified above. This original review remains a historical record; its statements
about v1 visibility, missing rebuild raw data and the failed 5173 startup still apply
to that report. Human comparison and #26/#28 production decisions remain open.
