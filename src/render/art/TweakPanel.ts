import type { WebGLRenderer } from "three";
import type { SceneLighting } from "./lighting";
import { HEMISPHERE_INTENSITY, SHADOW_INTENSITY } from "./lighting";
import { PALETTE_KEYS, type PaletteKey, basePaletteValue, cssColor, palette, paletteOverrides, setPaletteOverride } from "./palette";
import { SUN_ELEVATION_RAD } from "./shadowFit";
import { VIGNETTE_STRENGTH, type Vignette } from "./vignette";

/**
 * The lookdev tweak panel (art direction "Pipeline"; dev builds, or `?tweak=1`):
 * palette overrides by key, sun elevation, exposure, shadow intensity,
 * hemisphere intensity and the vignette, applied live. Export prints the
 * changed values to paste into `palette.ts` and `lighting.ts`; nothing is ever
 * persisted, and a reload returns to the committed values. A plain DOM panel,
 * so render never imports the React HUD.
 */

export interface TweakTargets {
  readonly lighting: SceneLighting;
  readonly renderer: WebGLRenderer;
  readonly vignette: Vignette;
  /** A palette value changed: resync uniforms and rebuild what bakes colour. */
  onPaletteChange(): void;
  /** Anything else changed: resync exposure-dependent uniforms and request a frame. */
  onChange(): void;
}

export interface TweakValues {
  readonly sunElevationDeg: number;
  readonly exposure: number;
  readonly shadowIntensity: number;
  readonly hemisphereIntensity: number;
  readonly vignette: number;
}

export const TWEAK_DEFAULTS: TweakValues = {
  sunElevationDeg: (SUN_ELEVATION_RAD * 180) / Math.PI,
  exposure: 1,
  shadowIntensity: SHADOW_INTENSITY,
  hemisphereIntensity: HEMISPHERE_INTENSITY,
  vignette: VIGNETTE_STRENGTH,
};

/** The export text: changed palette keys as hex, and every lighting value that differs from its default. */
export function tweakExport(values: TweakValues, overrides: Partial<Record<PaletteKey, number>>): string {
  const lighting: Record<string, number> = {};
  for (const key of Object.keys(TWEAK_DEFAULTS) as (keyof TweakValues)[]) {
    if (Math.abs(values[key] - TWEAK_DEFAULTS[key]) > 1e-9) lighting[key] = Number(values[key].toFixed(4));
  }
  const paletteOut: Record<string, string> = {};
  for (const [key, value] of Object.entries(overrides)) if (value !== undefined) paletteOut[key] = `0x${value.toString(16).padStart(6, "0")}`;
  return JSON.stringify({ palette: paletteOut, lighting }, null, 2);
}

interface Slider {
  readonly key: keyof TweakValues;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

const SLIDERS: readonly Slider[] = [
  { key: "sunElevationDeg", label: "Sun elevation °", min: 15, max: 75, step: 0.5 },
  { key: "exposure", label: "Exposure", min: 0.5, max: 1.8, step: 0.01 },
  { key: "shadowIntensity", label: "Shadow intensity", min: 0, max: 1, step: 0.01 },
  { key: "hemisphereIntensity", label: "Hemisphere", min: 0, max: 2.5, step: 0.01 },
  { key: "vignette", label: "Vignette", min: 0, max: 0.7, step: 0.01 },
];

export class TweakPanel {
  readonly element: HTMLDivElement;
  private readonly values: { -readonly [K in keyof TweakValues]: number } = { ...TWEAK_DEFAULTS };
  private readonly abort = new AbortController();
  private readonly sliders: { readonly slider: Slider; readonly input: HTMLInputElement; readonly readout: HTMLSpanElement }[] = [];

  constructor(
    parent: HTMLElement,
    private readonly targets: TweakTargets,
  ) {
    const el = document.createElement("div");
    this.element = el;
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "Lookdev tweak panel");
    Object.assign(el.style, {
      position: "fixed",
      top: "8px",
      right: "8px",
      width: "250px",
      padding: "8px 10px",
      font: "12px/1.5 system-ui, sans-serif",
      fontVariantNumeric: "tabular-nums",
      color: cssColor(palette.uiInk),
      background: cssColor(palette.uiParchment),
      border: `1px solid ${cssColor(palette.uiBorder)}`,
      borderRadius: "4px",
      zIndex: "20",
      maxHeight: "calc(100vh - 16px)",
      overflowY: "auto",
    } satisfies Partial<CSSStyleDeclaration>);
    const signal = this.abort.signal;

    const title = document.createElement("strong");
    title.textContent = "Lookdev (not saved)";
    el.appendChild(title);

    for (const s of SLIDERS) {
      const row = this.row(s.label);
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(s.min);
      input.max = String(s.max);
      input.step = String(s.step);
      input.value = String(this.values[s.key]);
      input.style.width = "100%";
      const readout = row.querySelector("span.value") as HTMLSpanElement;
      readout.textContent = this.values[s.key].toFixed(2);
      input.addEventListener(
        "input",
        () => {
          this.values[s.key] = Number(input.value);
          readout.textContent = this.values[s.key].toFixed(2);
          this.apply();
        },
        { signal },
      );
      row.appendChild(input);
      this.sliders.push({ slider: s, input, readout });
    }

    // Palette: pick a key, then its colour.
    const paletteRow = this.row("Palette");
    const select = document.createElement("select");
    for (const key of PALETTE_KEYS) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = key;
      select.appendChild(option);
    }
    const colour = document.createElement("input");
    colour.type = "color";
    const syncColour = () => {
      colour.value = cssColor(palette[select.value as PaletteKey]);
    };
    syncColour();
    select.addEventListener("change", syncColour, { signal });
    colour.addEventListener(
      "input",
      () => {
        setPaletteOverride(select.value as PaletteKey, Number.parseInt(colour.value.slice(1), 16));
        this.targets.onPaletteChange();
      },
      { signal },
    );
    const revert = this.button("Revert key", () => {
      setPaletteOverride(select.value as PaletteKey, undefined);
      syncColour();
      this.targets.onPaletteChange();
    });
    paletteRow.append(select, colour, revert);

    const output = document.createElement("textarea");
    output.readOnly = true;
    output.rows = 6;
    Object.assign(output.style, { width: "100%", font: "11px ui-monospace, monospace", display: "none" } satisfies Partial<CSSStyleDeclaration>);
    const actions = document.createElement("div");
    actions.append(
      this.button("Export", () => {
        output.value = tweakExport(this.values, paletteOverrides());
        output.style.display = "block";
        output.select();
      }),
      this.button("Reset all", () => {
        for (const key of PALETTE_KEYS) if (palette[key] !== basePaletteValue(key)) setPaletteOverride(key, undefined);
        Object.assign(this.values, TWEAK_DEFAULTS);
        for (const { slider, input, readout } of this.sliders) {
          input.value = String(this.values[slider.key]);
          readout.textContent = this.values[slider.key].toFixed(2);
        }
        syncColour();
        this.apply();
        this.targets.onPaletteChange();
      }),
    );
    el.append(actions, output);
    parent.appendChild(el);
  }

  dispose(): void {
    this.abort.abort();
    this.element.remove();
  }

  private apply(): void {
    const { lighting, renderer, vignette } = this.targets;
    lighting.sunElevationRad = (this.values.sunElevationDeg * Math.PI) / 180;
    renderer.toneMappingExposure = this.values.exposure;
    lighting.sun.shadow.intensity = this.values.shadowIntensity;
    lighting.hemisphere.intensity = this.values.hemisphereIntensity;
    vignette.setStrength(this.values.vignette);
    this.targets.onChange();
  }

  private row(label: string): HTMLDivElement {
    const row = document.createElement("div");
    row.style.marginTop = "6px";
    const name = document.createElement("span");
    name.textContent = `${label} `;
    const value = document.createElement("span");
    value.className = "value";
    value.style.float = "right";
    row.append(name, value);
    this.element.appendChild(row);
    return row;
  }

  private button(text: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.style.marginRight = "4px";
    b.style.font = "inherit";
    b.addEventListener("click", onClick, { signal: this.abort.signal });
    return b;
  }
}
