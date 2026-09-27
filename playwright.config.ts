import { defineConfig } from "@playwright/test";

/**
 * Playwright e2e (agent evidence, never human evidence): its own Vite dev
 * server on a fixed free port (5232, --strictPort, so it never attaches to
 * someone else's server), system Chrome, and specs named `*.e2e.ts` so
 * Vitest's default `*.test.*`/`*.spec.*` include never picks them up.
 *
 *   npx playwright test                                  # the e2e suite
 *   CAPTURE=1 npx playwright test --project=capture      # manual-check screenshots → test-results/d3-manual/
 */
const PORT = 5232;
const capture = process.env.CAPTURE === "1";

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/playwright",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: "chrome",
    viewport: { width: 1280, height: 800 },
    // WebGL in headless Chrome.
    launchOptions: { args: ["--enable-gpu", "--use-angle=metal", "--ignore-gpu-blocklist"] },
  },
  projects: [
    { name: "e2e", testMatch: /.*\.e2e\.ts$/ },
    ...(capture ? [{ name: "capture", testMatch: /.*\.capture\.ts$/ }] : []),
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
