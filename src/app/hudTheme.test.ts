import { describe, expect, it } from "vitest";
import { cssColor, palette } from "../render/art/palette";
import { hudThemeVars } from "./hudTheme";

describe("HUD theme", () => {
  it("hands the HUD the UI palette tokens as CSS custom properties", () => {
    const vars = hudThemeVars();
    expect(vars["--hud-parchment"]).toBe(cssColor(palette.uiParchment));
    expect(vars["--hud-amber"]).toBe(cssColor(palette.signalAmber));
    expect(Object.keys(vars).sort()).toEqual(["--hud-amber", "--hud-border", "--hud-brass", "--hud-green", "--hud-ink", "--hud-parchment", "--hud-red"]);
  });
});
