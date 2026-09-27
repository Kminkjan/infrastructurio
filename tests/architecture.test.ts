import { describe, expect, it } from "vitest";

/**
 * Architecture rules enforced by source scanning. There is no linter or CI,
 * so these tests are the guard:
 * - src/core is deterministic and DOM-free: no imports outside src/core, no
 *   three/react, no wall-clock, randomness, DOM or console APIs;
 * - trigonometry and friends only in the whitelisted geometry modules;
 * - src/tools has no three, DOM, clock or randomness (reducers are pure);
 *   src/render never imports src/ui;
 * - src/render, src/tools and src/ui reach the core only through
 *   core/sim/api.ts and the pure core/geometry/sample.ts (src/app, the
 *   composition root, may import the core directly);
 * - no hex colour literal in src/render, src/ui or src/app outside
 *   render/art/palette.ts, the single colour source (art direction "Palette").
 * A negative self-check proves each scanner actually fires.
 */

const sources = import.meta.glob<string>("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});

const isTest = (path: string) => /\.(test|bench)\.tsx?$/.test(path);

const TRIG_ALLOWED = new Set([
  "/src/core/geometry/sample.ts",
  "/src/core/geometry/clearance.ts",
  "/src/core/geometry/templates.ts",
]);

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function importSpecifiers(code: string): string[] {
  const specs: string[] = [];
  const re = /\b(?:import|export)\b[^'"`]*?from\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s+["']([^"']+)["']/g;
  for (const match of code.matchAll(re)) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (spec) specs.push(spec);
  }
  return specs;
}

function resolveRelative(fromFile: string, spec: string): string {
  const parts = fromFile.split("/").slice(0, -1);
  for (const segment of spec.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}

function coreViolations(path: string, raw: string): string[] {
  const code = stripComments(raw);
  const problems: string[] = [];
  for (const spec of importSpecifiers(code)) {
    if (!spec.startsWith(".")) problems.push(`imports package "${spec}"`);
    else if (!resolveRelative(path, spec).startsWith("/src/core/")) problems.push(`imports outside core "${spec}"`);
  }
  const forbidden: [RegExp, string][] = [
    [/\bMath\.random\b/, "Math.random"],
    [/\bDate\b/, "Date"],
    [/\bperformance\s*\./, "performance"],
    [/\bconsole\s*\./, "console"],
    [/\b(?:window|document|globalThis)\b/, "DOM/global access"],
    [/\b(?:setTimeout|setInterval|requestAnimationFrame|structuredClone)\b/, "timer/host API"],
    [/\bfor\s*\([^;)]*\bin\b/, "for…in"],
  ];
  for (const [re, name] of forbidden) if (re.test(code)) problems.push(`uses ${name}`);
  if (!TRIG_ALLOWED.has(path) && /\bMath\.(?:sin|cos|tan|asin|acos|atan2?|sinh|cosh|tanh|pow|exp|expm1|log|log1p|log2|log10|hypot|cbrt)\b/.test(code)) {
    problems.push("uses transcendental Math outside geometry/{sample,clearance,templates}.ts");
  }
  return problems;
}

function layerViolations(path: string, raw: string): string[] {
  const code = stripComments(raw);
  const problems: string[] = [];
  for (const spec of importSpecifiers(code)) {
    const target = spec.startsWith(".") ? resolveRelative(path, spec) : spec;
    if (path.startsWith("/src/tools/")) {
      if (target === "three" || target.startsWith("three/")) problems.push("tools import three");
      if (target.startsWith("/src/render/") || target.startsWith("/src/ui/") || target === "react") problems.push(`tools import ${spec}`);
    }
    if (path.startsWith("/src/render/") && target.startsWith("/src/ui/")) problems.push(`render imports ui ${spec}`);
  }
  if (path.startsWith("/src/tools/")) {
    // Reducers are pure: the same state, event and ctx always give the same result.
    const impure: [RegExp, string][] = [
      [/\b(?:window|document|navigator|globalThis|localStorage|sessionStorage)\b/, "tools touch the DOM"],
      [/\b(?:HTMLElement|Element|Event|KeyboardEvent|PointerEvent|MouseEvent|WheelEvent)\b/, "tools use DOM types"],
      [/\bMath\.random\b|\bDate\b|\bperformance\s*\./, "tools read a clock or randomness"],
      [/\b(?:setTimeout|setInterval|requestAnimationFrame|queueMicrotask)\b/, "tools schedule work"],
    ];
    for (const [re, name] of impure) if (re.test(code)) problems.push(name);
  }
  return problems;
}

/** The only core modules the edges (render, tools, ui) may import. */
const CORE_GATEWAYS = new Set(["/src/core/sim/api", "/src/core/geometry/sample"]);

/** Render, tools and ui reach the core only through `sim/api.ts` and `geometry/sample.ts`. */
function coreGatewayViolations(path: string, raw: string): string[] {
  if (!/^\/src\/(?:render|tools|ui)\//.test(path)) return [];
  const problems: string[] = [];
  for (const spec of importSpecifiers(stripComments(raw))) {
    if (!spec.startsWith(".")) continue;
    const target = resolveRelative(path, spec).replace(/\.(?:ts|tsx|js)$/, "");
    if (target.startsWith("/src/core/") && !CORE_GATEWAYS.has(target)) problems.push(`imports core outside sim/api.ts and geometry/sample.ts "${spec}"`);
  }
  return problems;
}

const COLOUR_SOURCE = "/src/render/art/palette.ts";

/** 0xRRGGBB, #RRGGBB or #RGB; longer hex (hash constants like 0x85ebca6b) never matches. */
function colourViolations(path: string, raw: string): string[] {
  if (!/^\/src\/(?:render|ui|app)\//.test(path) || path === COLOUR_SOURCE) return [];
  const literals = stripComments(raw).match(/\b0x[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) ?? [];
  return literals.map((literal) => `hex colour literal ${literal} outside palette.ts`);
}

describe("architecture boundaries", () => {
  it("finds source files to scan", () => {
    expect(Object.keys(sources).some((p) => p.startsWith("/src/core/"))).toBe(true);
  });

  it("keeps src/core deterministic and DOM-free", () => {
    const failures = Object.entries(sources)
      .filter(([path]) => path.startsWith("/src/core/") && !isTest(path))
      .flatMap(([path, code]) => coreViolations(path, code).map((v) => `${path}: ${v}`));
    expect(failures).toEqual([]);
  });

  it("keeps tools free of three/DOM and render free of ui imports", () => {
    const failures = Object.entries(sources)
      .filter(([path]) => !isTest(path))
      .flatMap(([path, code]) => layerViolations(path, code).map((v) => `${path}: ${v}`));
    expect(failures).toEqual([]);
  });

  it("keeps render, tools and ui on the core's public surface", () => {
    const failures = Object.entries(sources)
      .filter(([path]) => !isTest(path))
      .flatMap(([path, code]) => coreGatewayViolations(path, code).map((v) => `${path}: ${v}`));
    expect(failures).toEqual([]);
  });

  it("keeps every colour literal in palette.ts", () => {
    const failures = Object.entries(sources)
      .filter(([path]) => !isTest(path))
      .flatMap(([path, code]) => colourViolations(path, code).map((v) => `${path}: ${v}`));
    expect(failures).toEqual([]);
  });

  it("detects violations (negative self-check)", () => {
    const bad = [
      'import { Mesh } from "three";',
      'import { x } from "../../render/scene";',
      "const n = Math.random();",
      "const t = Date.now();",
      "const s = Math.sin(1);",
      "for (const k in obj) {}",
      "window.alert(1);",
    ].join("\n");
    const found = coreViolations("/src/core/track/example.ts", bad);
    expect(found.length).toBe(7);
    expect(coreViolations("/src/core/geometry/sample.ts", "const s = Math.sin(1);")).toEqual([]);
    expect(layerViolations("/src/tools/track.ts", 'import * as T from "three";')).not.toEqual([]);
    expect(
      layerViolations(
        "/src/tools/track.ts",
        ["document.title;", "(e: KeyboardEvent) => e;", "const t = performance.now();", "setTimeout(f, 1);"].join("\n"),
      ),
    ).toEqual(["tools touch the DOM", "tools use DOM types", "tools read a clock or randomness", "tools schedule work"]);
    expect(layerViolations("/src/tools/track.ts", 'import type { ToolEvent } from "./types";\nconst d = Math.hypot(1, 2);')).toEqual([]);
    expect(layerViolations("/src/render/hud.ts", 'import { Hud } from "../ui/Hud";')).not.toEqual([]);
    expect(coreViolations("/src/core/a.ts", '// Math.random() in a comment\nimport { b } from "./b";')).toEqual([]);
    expect(coreViolations("/src/core/track/a.ts", 'import { c } from "../lattice";')).toEqual([]);
    expect(coreGatewayViolations("/src/render/terrain/x.ts", 'import { toWorld } from "../../core/lattice";')).toHaveLength(1);
    expect(coreGatewayViolations("/src/tools/track.ts", 'import type { AuthoredState } from "../core/track/authored";')).toHaveLength(1);
    expect(coreGatewayViolations("/src/ui/Hud.tsx", 'import { x } from "../core/scenarios/baltic-diorama.ts";')).toHaveLength(1);
    expect(coreGatewayViolations("/src/render/track/x.ts", 'import { toWorld } from "../../core/sim/api";\nimport { samplePiece } from "../../core/geometry/sample";')).toEqual([]);
    expect(coreGatewayViolations("/src/render/core/x.ts", 'import { FrameScheduler } from "./FrameScheduler";')).toEqual([]);
    expect(coreGatewayViolations("/src/app/main.ts", 'import { generateTerrain } from "../core/terrain";')).toEqual([]);
    expect(colourViolations("/src/render/scenery/x.ts", "const c = 0xc0643f;")).toHaveLength(1);
    expect(colourViolations("/src/ui/Hud.tsx", 'const s = { color: "#fff", border: "1px solid #d8ccb4" };')).toHaveLength(2);
    expect(colourViolations("/src/app/main.ts", "const n = 0x6d2b79f5; // 0xc0643f in a comment")).toEqual([]);
    expect(colourViolations(COLOUR_SOURCE, "grass: 0x8fa66b,")).toEqual([]);
    expect(colourViolations("/src/core/a.ts", "const salt = 0x464f52;")).toEqual([]);
    expect(colourViolations("/src/render/a.ts", 'document.querySelector("#world");')).toEqual([]);
  });
});
