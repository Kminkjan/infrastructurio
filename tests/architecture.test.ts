import { describe, expect, it } from "vitest";

/**
 * Architecture rules enforced by source scanning. There is no linter or CI,
 * so these tests are the guard:
 * - src/core is deterministic and DOM-free: no imports outside src/core, no
 *   three/react, no wall-clock, randomness, DOM or console APIs;
 * - trigonometry and friends only in the whitelisted geometry modules;
 * - src/tools has no three or DOM; src/render never imports src/ui.
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
  if (path.startsWith("/src/tools/") && /\b(?:window|document)\b/.test(code)) problems.push("tools touch the DOM");
  return problems;
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
    expect(layerViolations("/src/render/hud.ts", 'import { Hud } from "../ui/Hud";')).not.toEqual([]);
    expect(coreViolations("/src/core/a.ts", '// Math.random() in a comment\nimport { b } from "./b";')).toEqual([]);
    expect(coreViolations("/src/core/track/a.ts", 'import { c } from "../lattice";')).toEqual([]);
  });
});
