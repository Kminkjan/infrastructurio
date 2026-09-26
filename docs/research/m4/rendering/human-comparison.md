# Perform the paired human comparison

No human observations have been collected by this change. Budget about 20 minutes.
The owner can participate; record prior familiarity so this is not described as a
first-time-player study. For additional participants alternate which view comes first.

```sh
npm ci
npm run research:m4:human
```

Open the printed **Human comparison** URL in a desktop browser. This starts a
dedicated server on an available port, serving a frozen source copy. It leaves other
servers alone. Keep the terminal running. A restart is required after source edits.
The page has participant/context fields, five task prompts, start/record controls
and a download button. Use an anonymous code; no personal data is needed.

1. Toss a coin for the first view. The “other view” link can switch before starting.
2. Record order, device/browser, previous editing experience and input/access needs.
3. Try each task without facilitator coaching. Think aloud; stop after roughly two
   minutes if stuck. The time recorded includes entering notes, so it is session
   elapsed time, not a precise motor-performance measure.
4. Record wrong selections, retries, help, confusion and the participant's own
   crossing/queue explanation. “Completed” is a self-report, not an automatic pass.
5. Download this view's JSON **before** opening the other view. Repeat the same tasks
   there, download its JSON, and provide both files plus a short preference/reason.

No autosave or upload occurs. Closing/reloading the page loses in-memory observations;
a navigation warning reduces accidental loss. Keep the downloaded files. Incomplete
exports report their task count and unfinished task. The interaction trace supports
review but cannot tell whether a person understood the view. Do not count a browser
smoke test, agent-entered text, or projected-coordinate automation as participant data.

For a facilitated session, record observations verbatim before offering help. Keep
help and outcomes separate. Do not teach the layer-filter solution before the hidden
queue task. Existing visible labels/instructions are part of the evaluated controls.
The last task probes keyboard limitations; pointer drawing remains a known gap.
No undo, free camera, topology validation or live traffic exists in this adapter.

Review both exports for task completion, errors, help, elevation/queue comprehension,
control access and order effects. An owner session is useful formative evidence, not
broad usability validation. Record findings and follow-ups before accepting or
superseding ADR 0004; do not choose the renderer from frame timings alone.

## Measurement reproduction (automated, separate from the session)

```sh
npm run research:m4:rendering -- /tmp/m4-rendering-new-run
npm run verify:m4:rendering -- /tmp/m4-rendering-new-run/results.json
```

The output directory must not already exist. The runner starts/stops its own Vite
server, with a frozen copy of application/experiment source and lockfile. Installed
node_modules are shared, so run `npm ci` first and do not modify dependencies during
measurement. The owned server serves a provenance manifest; the report binds that
manifest to local source hashes and the verifier rejects mismatch. This establishes
reproduction provenance within a trusted local runner, not cryptographic attestation
against a malicious server or modified dependencies.

Schema v2 preserves raw edit-rebuild samples plus visibility state at sampling start,
every visibilitychange event and sampling end. The verifier rejects any hidden
interval, even if the page is visible again at the end. Browser visibility APIs do
not prove an unobscured window or human attention. Keep Chrome foreground throughout.
CPU still measures update/render submission, not GPU completion. All earlier workload
limitations remain: disconnected strips and overlapping animated icons, no traffic.

Historic `results.json` and images are unchanged. `source-v1/` preserves their measured
source bytes (copied from PR #48's baseline); the verifier uses that archive for v1.
It does not reinterpret old end-only visibility or invent missing rebuild samples.

## Verification of this revision

[New raw automated report](results-v2.json): headed Chrome on Apple M5 Pro / 48 GiB,
DPR 1, same synthetic workloads as v1. Per-repeat frame p95 is 9.1–9.3 ms in Pixi
and 9.2–9.3 ms in Three.js; stress update/submit CPU p95 is 1.3 ms and 0.9 ms.
The 27 raw rebuild samples per view recompute to p95 0.4 ms and 0.8 ms.
All twelve windows have visible start/end states and no hidden visibility events.
These meet the existing scoped research guardrails, not an integrated-region budget.

Both reports verify; 25 research checks, 73 application tests and production
TypeScript/build pass. Synthetic browser checks exercise all five human task records
and JSON export in each mode, with entries explicitly marked automated and kept out
of committed participant evidence. Original M3 diff SHA-256 remains
`42c4eec5ee1290dd8fbfd62cac7edccce0bf23b53579a12dff50c7877b993841`.
