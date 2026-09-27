import { cssColor, palette } from "../render/art/palette";

/**
 * The HUD's colours as CSS custom properties on its mount (art direction
 * "Palette": the HUD receives palette values as custom properties set from
 * `palette.ts` at start-up). `src/ui` reads only the variables, so it never
 * imports render and holds no colour literal.
 */
export function hudThemeVars(): Record<string, string> {
  return {
    "--hud-parchment": cssColor(palette.uiParchment),
    "--hud-border": cssColor(palette.uiBorder),
    "--hud-ink": cssColor(palette.uiInk),
    "--hud-brass": cssColor(palette.brass),
    "--hud-green": cssColor(palette.signalGreen),
    "--hud-amber": cssColor(palette.signalAmber),
    "--hud-red": cssColor(palette.signalRed),
  };
}

export function applyHudTheme(element: HTMLElement): void {
  for (const [name, value] of Object.entries(hudThemeVars())) element.style.setProperty(name, value);
}
