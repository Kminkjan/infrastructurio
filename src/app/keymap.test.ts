import { describe, expect, it } from "vitest";
import { type KeyInput, WheelStepper, classifyKey, isMacPlatform, precisionHeld } from "./keymap";

function key(k: string, code: string, mods: Partial<KeyInput> = {}): KeyInput {
  return { key: k, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...mods };
}

const select = { trackActive: false, precision: false };
const track = { trackActive: true, precision: false };
const precise = { trackActive: true, precision: true };

describe("key routing", () => {
  it("undoes on Ctrl/Cmd+Z and redoes on Ctrl/Cmd+Shift+Z or Ctrl+Y, case-insensitively, in any tool", () => {
    for (const ctx of [select, track, precise]) {
      expect(classifyKey(key("z", "KeyZ", { ctrlKey: true }), ctx)).toEqual({ kind: "undo" });
      expect(classifyKey(key("Z", "KeyZ", { metaKey: true }), ctx)).toEqual({ kind: "undo" });
      expect(classifyKey(key("Z", "KeyZ", { ctrlKey: true, shiftKey: true }), ctx)).toEqual({ kind: "redo" });
      expect(classifyKey(key("z", "KeyZ", { metaKey: true, shiftKey: true }), ctx)).toEqual({ kind: "redo" });
      expect(classifyKey(key("y", "KeyY", { ctrlKey: true }), ctx)).toEqual({ kind: "redo" });
      expect(classifyKey(key("Y", "KeyY", { ctrlKey: true }), ctx)).toEqual({ kind: "redo" });
    }
    // Cmd+Y is not a redo binding (the issue names Ctrl+Y); a layout's `z` key wins over its position.
    expect(classifyKey(key("y", "KeyY", { metaKey: true }), select)).toEqual({ kind: "camera" });
    expect(classifyKey(key("z", "KeyW", { ctrlKey: true }), select)).toEqual({ kind: "undo" });
  });

  it("selects Track on 1, Bridge on 5 and Tunnel on 6, and routes Esc to the tool", () => {
    expect(classifyKey(key("1", "Digit1"), select)).toEqual({ kind: "select-tool", tool: "track" });
    expect(classifyKey(key("1", "Numpad1"), track)).toEqual({ kind: "select-tool", tool: "track" });
    expect(classifyKey(key("5", "Digit5"), select)).toEqual({ kind: "select-tool", tool: "bridge" });
    expect(classifyKey(key("6", "Numpad6"), track)).toEqual({ kind: "select-tool", tool: "tunnel" });
    // AZERTY types "&" on the top-row 1 key: the physical key still selects; Shift gives the digit itself.
    expect(classifyKey(key("&", "Digit1"), select)).toEqual({ kind: "select-tool", tool: "track" });
    expect(classifyKey(key("6", "Digit6", { shiftKey: true }), select)).toEqual({ kind: "select-tool", tool: "tunnel" });
    // …but its 6 key types "-", the camera's zoom-out, which stays the camera's.
    expect(classifyKey(key("-", "Digit6"), select)).toEqual({ kind: "camera" });
    // 2–4 and 7 stay unbound until their tools exist; modified digits are not tools.
    for (const d of ["2", "3", "4", "7"]) expect(classifyKey(key(d, `Digit${d}`), select)).toEqual({ kind: "camera" });
    expect(classifyKey(key("5", "Digit5", { ctrlKey: true }), select)).toEqual({ kind: "camera" });
    expect(classifyKey(key("%", "Digit5", { shiftKey: true }), select)).toEqual({ kind: "camera" });
    expect(classifyKey(key("Escape", "Escape"), track)).toEqual({ kind: "escape" });
  });

  it("toggles the occlusion aids on plain H and U in any tool, and cycles picks on C with a track tool", () => {
    for (const ctx of [select, track]) {
      expect(classifyKey(key("h", "KeyH"), ctx)).toEqual({ kind: "toggle-decks" });
      expect(classifyKey(key("u", "KeyU"), ctx)).toEqual({ kind: "toggle-xray" });
    }
    expect(classifyKey(key("c", "KeyC"), track)).toEqual({ kind: "cycle-pick" });
    expect(classifyKey(key("c", "KeyC"), select)).toEqual({ kind: "camera" });
    // With a modifier they belong to the browser (Ctrl+H history, Ctrl+C copy, ⌥ is precision on macOS), and Shift is not plain.
    expect(classifyKey(key("h", "KeyH", { ctrlKey: true }), track)).toEqual({ kind: "camera" });
    expect(classifyKey(key("c", "KeyC", { metaKey: true }), track)).toEqual({ kind: "camera" });
    expect(classifyKey(key("˙", "KeyH", { altKey: true }), precise)).toEqual({ kind: "camera" });
    expect(classifyKey(key("U", "KeyU", { shiftKey: true }), select)).toEqual({ kind: "camera" });
  });

  it("matches the aids by character, lets the camera's physical keys win, and falls back to the physical key without Latin letters", () => {
    // Dvorak: the key at KeyJ types "h".
    expect(classifyKey(key("h", "KeyJ"), select)).toEqual({ kind: "toggle-decks" });
    // Workman types "h" on the D key: the camera keeps panning.
    expect(classifyKey(key("h", "KeyD"), select)).toEqual({ kind: "camera" });
    // A Latin layout that types another letter at KeyH does not get H there.
    expect(classifyKey(key("d", "KeyH"), select)).toEqual({ kind: "camera" });
    // Russian ЙЦУКЕН: KeyH types "р", KeyU "г".
    expect(classifyKey(key("р", "KeyH"), select)).toEqual({ kind: "toggle-decks" });
    expect(classifyKey(key("г", "KeyU"), select)).toEqual({ kind: "toggle-xray" });
    expect(classifyKey(key("с", "KeyC"), track)).toEqual({ kind: "cycle-pick" });
  });

  it("gives the arrows to the lattice cursor only while Track is active; WASD always pans", () => {
    expect(classifyKey(key("ArrowUp", "ArrowUp"), track)).toEqual({ kind: "cursor", direction: "up" });
    expect(classifyKey(key("ArrowLeft", "ArrowLeft"), track)).toEqual({ kind: "cursor", direction: "left" });
    expect(classifyKey(key("ArrowUp", "ArrowUp"), select)).toEqual({ kind: "camera" });
    expect(classifyKey(key("w", "KeyW"), track)).toEqual({ kind: "camera" });
  });

  it("starts and commits on Enter, and steps the height on PgUp/PgDn and ] [", () => {
    expect(classifyKey(key("Enter", "Enter"), track)).toEqual({ kind: "enter" });
    expect(classifyKey(key("Enter", "NumpadEnter"), track)).toEqual({ kind: "enter" });
    expect(classifyKey(key("PageUp", "PageUp"), track)).toEqual({ kind: "height", delta: 1 });
    expect(classifyKey(key("PageDown", "PageDown"), track)).toEqual({ kind: "height", delta: -1 });
    expect(classifyKey(key("]", "BracketRight"), track)).toEqual({ kind: "height", delta: 1 });
    expect(classifyKey(key("[", "BracketLeft"), track)).toEqual({ kind: "height", delta: -1 });
    // Layouts where the bracket sits elsewhere still match by character.
    expect(classifyKey(key("]", "Digit9", { altKey: false }), track)).toEqual({ kind: "height", delta: 1 });
    expect(classifyKey(key("Enter", "Enter"), select)).toEqual({ kind: "camera" });
  });

  it("keeps Enter, the arrows and the height keys while only the precision modifier is held", () => {
    // macOS: ⌥ is precision.
    expect(classifyKey(key("Enter", "Enter", { altKey: true }), precise)).toEqual({ kind: "enter" });
    expect(classifyKey(key("ArrowRight", "ArrowRight", { altKey: true }), precise)).toEqual({ kind: "cursor", direction: "right" });
    expect(classifyKey(key("PageUp", "PageUp", { altKey: true }), precise)).toEqual({ kind: "height", delta: 1 });
    // ⌥] and ⌥[ type ‘ and “ on a US Mac; while precision is held the physical keys still step the height.
    expect(classifyKey(key("‘", "BracketRight", { altKey: true }), precise)).toEqual({ kind: "height", delta: 1 });
    expect(classifyKey(key("“", "BracketLeft", { altKey: true }), precise)).toEqual({ kind: "height", delta: -1 });
    // Windows and Linux: Ctrl is precision.
    expect(classifyKey(key("Enter", "NumpadEnter", { ctrlKey: true }), precise)).toEqual({ kind: "enter" });
    expect(classifyKey(key("ArrowUp", "ArrowUp", { ctrlKey: true }), precise)).toEqual({ kind: "cursor", direction: "up" });
    expect(classifyKey(key("[", "BracketLeft", { ctrlKey: true }), precise)).toEqual({ kind: "height", delta: -1 });
    // A second modifier (AltGr is Ctrl+Alt; Cmd), or a modifier that is not the precision one, leaves them alone.
    expect(classifyKey(key("Enter", "Enter", { ctrlKey: true, altKey: true }), precise)).toEqual({ kind: "camera" });
    expect(classifyKey(key("ArrowUp", "ArrowUp", { metaKey: true, altKey: true }), precise)).toEqual({ kind: "camera" });
    expect(classifyKey(key("Enter", "Enter", { altKey: true }), track)).toEqual({ kind: "camera" });
  });

  it("matches the height brackets by character, so other layouts keep those physical keys", () => {
    // German QWERTZ: the keys at BracketRight and BracketLeft type "+" (the camera's zoom-in) and "ü".
    expect(classifyKey(key("+", "BracketRight"), track)).toEqual({ kind: "camera" });
    expect(classifyKey(key("ü", "BracketLeft"), track)).toEqual({ kind: "camera" });
    expect(classifyKey(key("+", "BracketRight", { shiftKey: true }), track)).toEqual({ kind: "camera" });
  });

  it("turns Q/E into end-heading steps only while precision is held; otherwise they rotate the camera", () => {
    expect(classifyKey(key("q", "KeyQ", { ctrlKey: true }), precise)).toEqual({ kind: "end-heading", delta: -1 });
    // ⌥E on macOS types a dead key; the physical code still matches.
    expect(classifyKey(key("Dead", "KeyE", { altKey: true }), precise)).toEqual({ kind: "end-heading", delta: 1 });
    expect(classifyKey(key("q", "KeyQ"), track)).toEqual({ kind: "camera" });
    expect(classifyKey(key("e", "KeyE"), select)).toEqual({ kind: "camera" });
  });

  it("keeps L and F3", () => {
    expect(classifyKey(key("l", "KeyL"), track)).toEqual({ kind: "labels" });
    expect(classifyKey(key("F3", "F3"), select)).toEqual({ kind: "perf" });
  });
});

describe("wheel routing", () => {
  it("zooms unless Track is active with Shift (height) or precision (radius)", () => {
    const w = new WheelStepper();
    expect(w.classify({ deltaX: 0, deltaY: 100, deltaMode: 0, shiftKey: false }, track)).toEqual({ kind: "camera" });
    expect(w.classify({ deltaX: 0, deltaY: 100, deltaMode: 0, shiftKey: true }, select)).toEqual({ kind: "camera" });
    expect(w.classify({ deltaX: 0, deltaY: -100, deltaMode: 0, shiftKey: true }, track)).toEqual({ kind: "height", steps: 1 });
    expect(w.classify({ deltaX: 0, deltaY: 100, deltaMode: 0, shiftKey: false }, precise)).toEqual({ kind: "radius", steps: -1 });
  });

  it("accumulates trackpad deltas into whole notches and counts line events as one step each", () => {
    const w = new WheelStepper();
    const small = { deltaX: 0, deltaY: -30, deltaMode: 0, shiftKey: false };
    const steps = [0, 1, 2, 3].map(() => w.classify(small, precise));
    expect(steps.map((s) => ("steps" in s ? s.steps : null))).toEqual([0, 0, 0, 1]);
    expect(w.classify({ deltaX: 0, deltaY: 3, deltaMode: 1, shiftKey: false }, precise)).toEqual({ kind: "radius", steps: -1 });
    // Shift+wheel reported as horizontal scroll.
    expect(w.classify({ deltaX: -100, deltaY: 0, deltaMode: 0, shiftKey: true }, track)).toEqual({ kind: "height", steps: 1 });
  });
});

describe("platform", () => {
  it("takes precision from Ctrl, or ⌥ on macOS", () => {
    expect(precisionHeld({ ctrl: true, alt: false }, false)).toBe(true);
    expect(precisionHeld({ ctrl: true, alt: false }, true)).toBe(false);
    expect(precisionHeld({ ctrl: false, alt: true }, true)).toBe(true);
    expect(isMacPlatform("MacIntel", "")).toBe(true);
    expect(isMacPlatform("Win32", "Mozilla/5.0 (Windows NT 10.0)")).toBe(false);
  });
});
