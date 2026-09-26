# experiments/m4 — evidence-pinned research harnesses

This code is measured evidence for `docs/research/m4`, and its bytes are hashed into committed reports.
- **Lane fixture (#27):** `lane-fixture.mjs`, `lane-fixture.checks.mjs`, `run-lane-study.mjs`.
- **2D/3D rendering study (#26):** `rendering/*`.
- **Decisions:** ADR 0003 (weight-1 vehicles; platoons rejected) and ADR 0004 (Pixi plan view, research reference only).
- **No CI exists.** After any change here, to `package*.json` or to `src/rendering/map-camera.ts`, run `npm run test:m4` and both `verify:m4:rendering` runs yourself.

## Frozen bytes: edits break checks
- **v2 hash pin.** `npm run test:m4` verifies `docs/research/m4/rendering/results-v2.json` against the **live** SHA-256 of:
  - `rendering/{scene,pixi-view,three-view,study,run-study,serve-study,human-session}.mjs`
  - `rendering/index.html`
  - `src/rendering/map-camera.ts`
  - the root `package-lock.json`

  Any byte change fails the check. That includes reformatting and **anything that rewrites the lockfile**: adding, removing, upgrading or downgrading a dependency, or running `npm install`/`update`/`dedupe`/`audit fix`.
- **Lane hash pin.** The lane trio is hashed in both `lane-results.json` and `lane-review-results.json`. **No test checks it**, so an edit passes `test:m4` silently while breaking reproduction, which deep-compares `sourceHashes` (`evidence-review.md`). Put new models, runners and checks in new files.
- **Never move or rename** these files. Manifest keys are relative paths (e.g. `../../../package-lock.json`) resolved from each file's own location, and the checks load the reports by relative URL.
- **Never "fix" a hash failure** by editing a report, a hash or the verifier's expectations. The legitimate route, with the owner's explicit OK first:
  1. Archive the v2 bytes byte-exact under `docs/research/m4/rendering/source-v2/`, mirroring `source-v1/`'s layout.
  2. Point v2 verification at the archive: the `modern ? import.meta.url` sourceRoot in `verify-results.mjs`.
  3. Make `modernFixture()` in `verify-results.checks.mjs` hash the same archive. Otherwise the "v2 validates" check fails and the eight "v2 rejects" checks pass for the wrong reason.
  4. Give any report measured from changed sources a new schemaVersion and file name, after extending the verifier, which rejects anything but v1/v2.
- **Verifier couplings.**
  - `verify-results.mjs` imports `defaultControls` from the **live** `scene.mjs` for both schemas.
  - Its `sources` constant *is* the v1 manifest (v2 = `sources` + serve-study + human-session), so adding a file there breaks both manifests.
  - Changing `defaultControls` breaks the draw check of **both** committed reports, and moving `sourceRoot` does not fix that. A route that changes `scene.mjs` must also pin each schema's draw targets, e.g. by importing `defaultControls` from that schema's archived `scene.mjs`.
- **Keep three source lists identical:**
  - the `run-study.mjs` `sourceHashes` names;
  - `serve-study.mjs` `sources`;
  - `verify-results.mjs` `sources` + serve-study + human-session.
- **The `verify-results*.mjs` files are not hashed.** You may harden them, but both committed reports must still pass, and the p95 stays `s[Math.floor(n*.95)]`.
- **Never run a formatter** here or on `docs/research/m4/rendering/source-v1/`.

## Conventions
- **Language:** plain ESM `.mjs`, not type-checked (tsconfig covers only `src`).
- **Lane model:** no imports, randomness or clock. Integer ticks. Plain-data state that survives `structuredClone` and passes `deepEqual`.
  - Positions are cells and time is ticks.
  - `step()` converts only the accumulated statistics (`journeySeconds`, `completedMaxSeconds`, `stoppedTripSeconds`) via `UNITS.tickSeconds`.
  - A missing sample is `null`, never 0. Lane arrays are `[lane0, lane1]`.
- **Units:** `UNITS` = 7.5 m cell, 0.5 s tick, 15 m/s, 40+4+40 cells.
- **The rendering harness deliberately imports app code:** `pixi-view.mjs` imports `map-camera.ts`, alongside pixi.js, three, vite and @playwright/test. The "no application imports" note in `docs/research/m4/README.md` applies to the lane files only.
- **Checks:** name them `*.checks.mjs`, using `node:test` and `node:assert/strict`.
  - Never name them `*.test.*` or `*.spec.*`: Vitest's default include would collect them.
  - `node --test` doesn't discover `.checks.mjs`, so register each file in the `test:m4` script.
- **p95 formulas differ on purpose:** the lane runner uses `v[ceil(.95n)-1]`; the rendering runner and verifier use `s[floor(.95n)]`. Don't unify them.
- **Stable values:**
  - `run-study.mjs` hard-codes the `window.study` API and the `index.html` IDs (#draw, #raise, #hide, #status, #selection, #top, #reset, #stress).
  - `verify-results.mjs` hard-codes:
    - the backend strings, viewport [960,600] and DPR 1;
    - the eight task names and the targets turn-lane/bridge/queue-0 (a direct click must hit `bridge`);
    - the reshape target [280,110];
    - the queue-cause status text;
    - the elevation-raise result 50 and the arrow nudge [5,0];
    - the provenance method;
    - three repeats of ≥100 samples each within a visible window of ≥3000 ms.

## Running
- **`npm run test:m4`:** about 0.3 s. Needs `node_modules`, because serve-study imports vite; the README's "no install needed" is stale.
- **`npm run research:m4:lanes -- <path>`:** about 1 s, macOS only (`sw_vers`).
  - It **overwrites `<path>` without checking**. Write to a scratch path, then copy the report to a NEW file under `docs/research/m4/`. Never pass a path under `docs/`.
  - Compare only `comparisons`, `units`, `bounds` and `sourceHashes`; timings vary.
- **`npm run research:m4:rendering -- <new-dir>`:** only when asked. It opens **headed system Chrome** (`npm ci` downloads no browsers) and runs on macOS only.
  - `<new-dir>` must not exist.
  - It starts its own Vite server from a temp snapshot, so no `npm run dev` is needed.
  - Keep Chrome in the foreground for about a minute; a hidden-visibility event fails v2.
  - Once Chrome has launched, `finally` writes `results.json` even if a task throws. That partial report looks valid, so always verify it before citing it.
  - Earlier failures write nothing, and a failed launch leaves an empty `<new-dir>`: use a new path.
- **Committing a rerun on unchanged sources:** keep schemaVersion 2 and copy the output to a new dated directory (e.g. `docs/research/m4/rendering/rerun-YYYY-MM-DD/`). Verify it, then add a dated note to `human-comparison.md`.
- **`npm run verify:m4:rendering [-- file]`:** defaults to the v1 report (the path is relative to the cwd).
- **`npm run research:m4:human`:** the deferred #26 paired study, not the #55 construction walkthrough.
  - It serves a copy, so restart it after edits.
  - `?human=1` fails under plain `npm run dev`, which has no `/__m4_provenance`.

## Evidence discipline
- **Bounds:** declare acceptance bounds as runner constants *before* the first comparison run (`run-lane-study.mjs` `bounds`).
  - A factor fails if any lane or case fails. Never retune bounds after seeing results.
  - Label budgets chosen after measurement as provisional regression guardrails.
- **New reports record:** schemaVersion, recordedAt, git HEAD, the SHA-256 of every measured file, hardware/OS/Node/browser/GPU as applicable, units, bounds, raw samples and limitations.
  - The committed reports predate this list: the v1 rendering report has no schemaVersion, and the lane reports keep timing summaries only.
  - Reruns of the frozen v2 rendering runner also omit git HEAD, units, bounds and limitations. Record those in the dated `human-comparison.md` note, never by editing the JSON or `run-study.mjs`.
- **Oracles:** `window.study` and projected-coordinate automation are test oracles, never human or participant evidence.
- **New experiments:**
  - Use new files or `experiments/m<N>/<topic>/`, with their own registered `.checks.mjs`.
  - The runner writes to a caller-supplied new path.
  - Put a README (question, method, bounds, reproduce, results, decision, limitations) and the raw report under `docs/research/`.
  - Record the decision in a Proposed ADR.
