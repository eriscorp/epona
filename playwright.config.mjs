import { defineConfig } from '@playwright/test'

// Electron E2E for Epona. These drive the BUILT app (out/main/index.js), so run
// `npm run build` first — the `e2e` npm script does this for you. Electron only
// allows one app instance per launch and the specs measure real OS window
// geometry, so keep this fully serial (workers: 1, no retries hiding flakiness).
// These also run in CI: the `e2e` job in .github/workflows/ci.yml is on
// windows-2022, which has a real desktop session (so no xvfb) and rebuilds the
// da-win32 native module first. See e2e/README.md.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  // Electron launches can be slow to reach a visible main window on a cold GPU.
  timeout: 60_000,
  expect: { timeout: 10_000 }
})
