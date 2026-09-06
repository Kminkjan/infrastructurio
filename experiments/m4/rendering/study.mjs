import { defaultControls, makeScene, vehicles } from "./scene.mjs";
const mode =
  new URLSearchParams(location.search).get("mode") === "3d" ? "3d" : "2d";
document.querySelector("#mode").textContent =
  mode === "2d" ? "Pixi · plan view" : "Three.js · orthographic oblique";
const { createView } = await import(
  mode === "2d" ? "./pixi-view.mjs" : "./three-view.mjs"
);
const view = await createView(document.querySelector("#view"));
view.canvas.tabIndex = 0;
view.canvas.setAttribute(
  "aria-label",
  "Infrastructure research scene. Target list provides keyboard selection; arrow keys move selected curve handles.",
);
let state,
  log = [],
  drawing = false,
  drag = null,
  frames = [],
  costs = [],
  sampling = false,
  last = null;
const rebuildTimingsMs = [];
const status = document.querySelector("#status");
function record(action, detail = {}) {
  log.push({ action, ...detail });
  document.querySelector("#log").textContent = log
    .slice(-6)
    .map((x) => JSON.stringify(x))
    .join("\n");
}
function update() {
  const start = performance.now();
  view.setScene(makeScene(state), vehicles(state.stress), state.selected);
  status.textContent = state.selected?.startsWith("queue")
    ? "Queue: 12 vehicles\nCause: yield to conflicting turn (authored fixture)\nDeck and road are not connected."
    : `Selected: ${state.selected || "none"}\nDeck elevation: ${state.bridgeZ} m\nCurve points: ${state.controls.length}/4`;
  rebuildTimingsMs.push(performance.now() - start);
}
function reset() {
  state = {
    controls: structuredClone(defaultControls),
    bridgeZ: 45,
    hideBridge: false,
    selected: null,
    stress: false,
  };
  drawing = false;
  drag = null;
  document.querySelector("#hide").checked = false;
  document.querySelector("#top").checked = false;
  document.querySelector("#selection").value = "";
  view.setCamera(false);
  update();
}
function select(id, method) {
  state.selected = id;
  record("select", { id, method });
  update();
}
function point(e) {
  const r = view.canvas.getBoundingClientRect();
  return [
    ((e.clientX - r.left) * 960) / r.width,
    ((e.clientY - r.top) * 600) / r.height,
  ];
}
view.canvas.addEventListener("pointerdown", (e) => {
  const p = point(e);
  if (drawing) {
    state.controls.push(view.unproject(p));
    record("draw-point", { point: state.controls.at(-1) });
    if (state.controls.length === 4) drawing = false;
    update();
    return;
  }
  const id = view.pick(p);
  select(id, "pointer");
  if (id?.startsWith("handle-")) {
    drag = Number(id.split("-")[1]);
    view.canvas.setPointerCapture(e.pointerId);
  }
});
view.canvas.addEventListener("pointermove", (e) => {
  if (drag !== null) {
    state.controls[drag] = view.unproject(point(e), 1);
    update();
  }
});
view.canvas.addEventListener("pointerup", () => {
  if (drag !== null)
    record("reshape", { index: drag, point: state.controls[drag] });
  drag = null;
});
view.canvas.addEventListener("keydown", (e) => {
  if (!state.selected?.startsWith("handle-")) return;
  const delta = {
    ArrowLeft: [-5, 0],
    ArrowRight: [5, 0],
    ArrowUp: [0, -5],
    ArrowDown: [0, 5],
  }[e.key];
  if (delta) {
    e.preventDefault();
    const i = Number(state.selected.split("-")[1]);
    state.controls[i] = state.controls[i].map((v, j) => v + delta[j]);
    record("keyboard-reshape", { index: i });
    update();
  }
});
document.querySelector("#draw").onclick = () => {
  state.controls = [];
  state.selected = null;
  drawing = true;
  record("begin-draw");
  update();
};
document.querySelector("#reset").onclick = () => {
  reset();
  record("reset");
};
document.querySelector("#selection").onchange = (e) =>
  select(e.target.value, "target-list");
document.querySelector("#hide").onchange = (e) => {
  state.hideBridge = e.target.checked;
  record("layer", { hidden: state.hideBridge });
  update();
};
document.querySelector("#top").onchange = (e) => {
  view.setCamera(e.target.checked);
  record("camera", { top: e.target.checked });
};
document.querySelector("#raise").onclick = () => {
  if (state.selected === "bridge") {
    state.bridgeZ += 5;
    record("raise", { z: state.bridgeZ });
    update();
  } else record("rejected-raise", { reason: "select bridge first" });
};
document.querySelector("#stress").onclick = () => {
  state.stress = true;
  state.selected = null;
  record("stress");
  update();
};
function frame(t) {
  const start = performance.now();
  view.render(t, state.stress);
  if (sampling) {
    if (last !== null) frames.push(t - last);
    costs.push(performance.now() - start);
    last = t;
  }
  requestAnimationFrame(frame);
}
reset();
requestAnimationFrame(frame);
// Read-only state and projection oracle for reproducible scripted input; edits use DOM input.
window.study = {
  get rebuildTimingsMs() { return [...rebuildTimingsMs]; },
  get state() {
    return structuredClone(state);
  },
  get log() {
    return structuredClone(log);
  },
  project: (p) => view.project(p),
  info: () => ({
    ...view.info(),
    userAgent: navigator.userAgent,
    dpr: devicePixelRatio,
    viewport: [960, 600],
  }),
  startSample() {
    frames = [];
    costs = [];
    last = null;
    sampling = true;
  },
  endSample() {
    sampling = false;
    return {
      frameIntervalsMs: frames,
      updateAndSubmitMs: costs,
      visibility: document.visibilityState,
    };
  },
};
