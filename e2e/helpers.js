import { _electron as electron, expect } from '@playwright/test'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const repoRoot = join(__dirname, '..')
export const mainEntry = join(repoRoot, 'out', 'main', 'index.js')

// Launch the BUILT Epona app under Electron.
//
// LOCALAPPDATA is redirected to a throwaway temp dir because src/main/index.js
// derives its userData (settings.json, caches) from %LOCALAPPDATA% at module
// load — pointing it at a temp dir keeps each run hermetic and off the real
// user profile. Pass `seedSettings` (a settings object) to pre-write
// settings.json so the app hydrates a known config; omit it to get defaults.
export async function launchEpona({ seedSettings, localAppData: reuseDir } = {}) {
  // Reuse a caller-supplied dir to test persistence across relaunches; otherwise
  // mint a fresh throwaway so the run is hermetic.
  const localAppData = reuseDir ?? mkdtempSync(join(tmpdir(), 'epona-e2e-'))
  if (seedSettings) {
    const dir = join(localAppData, 'Erisco', 'Epona')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(seedSettings, null, 2))
  }
  // Strip ELECTRON_RUN_AS_NODE — if it's set in the parent environment, the
  // launched electron binary runs as plain Node (no `app`, no windows) and the
  // main process throws at app.setPath. We want a real Electron app here.
  const env = { ...process.env, LOCALAPPDATA: localAppData, NODE_ENV: 'test' }
  delete env.ELECTRON_RUN_AS_NODE
  const electronApp = await electron.launch({ args: [mainEntry], cwd: repoRoot, env })
  return { electronApp, localAppData }
}

// Find the main renderer window and wait until it's actually shown. Epona pops a
// splash window first, so `firstWindow()` can return the wrong one — the splash
// has no preload, so we identify the real window by the presence of
// window.sparkAPI, then wait for the native window to become visible (the app
// keeps it hidden until the renderer signals 'app:ready').
export async function getMainWindow(electronApp) {
  let page = null
  for (let i = 0; i < 120 && !page; i++) {
    for (const w of electronApp.windows()) {
      const hasApi = await w.evaluate(() => !!window.sparkAPI).catch(() => false)
      if (hasApi) {
        page = w
        break
      }
    }
    if (!page) await electronApp.waitForEvent('window', { timeout: 500 }).catch(() => {})
  }
  if (!page) throw new Error('main renderer window (with sparkAPI) never appeared')

  const win = await electronApp.browserWindow(page)
  await expect.poll(() => win.evaluate((bw) => bw.isVisible()), { timeout: 20_000 }).toBe(true)
  await page.waitForSelector('[data-testid="main-panel"]', { state: 'visible' })
  return page
}

// Snapshot both the native window geometry (Electron main process) and the
// renderer's view of where its content actually sits on screen. `letterbox` is
// the whole point of the offset spec: for a frameless window with no client-area
// shift it should be ~0; a WS_THICKFRAME-induced left inset makes window.screenX
// drift right of the outer window's x, so screenX - bounds.x grows.
export async function readGeometry(electronApp, page) {
  const win = await electronApp.browserWindow(page)
  const native = await win.evaluate((bw) => ({
    bounds: bw.getBounds(),
    contentBounds: bw.getContentBounds()
  }))
  const dom = await page.evaluate(() => {
    // Screen-space left edge of an element, so we compare against the native
    // window position (both in the same CSS-pixel space). Tracks not just the
    // outer panel but the actual things a human watches for the "indent": the
    // Epona title and the "Client: …" status line.
    const screenLeftOf = (sel) => {
      const el = document.querySelector(sel)
      return el ? Math.round(window.screenX + el.getBoundingClientRect().left) : null
    }
    return {
      screenX: window.screenX,
      innerWidth: window.innerWidth,
      panelScreenLeft: screenLeftOf('[data-testid="main-panel"]'),
      titleScreenLeft: screenLeftOf('[data-testid="app-title"]'),
      statusScreenLeft: screenLeftOf('[data-testid="client-status"]')
    }
  })
  return {
    native,
    dom,
    letterbox: dom.screenX - native.bounds.x,
    contentInset: native.contentBounds.x - native.bounds.x
  }
}

// Stand up a throwaway git repo with one Epona-managed worktree under
// <repo>/.worktrees/<branch>, mirroring what a repo-mode launch leaves on disk.
// Used by the flush-worktrees regression spec: Settings → Maintenance → Flush
// must actually remove it. Returns absolute paths so the spec can assert the
// worktree dir is gone and point seeded settings at the repo.
export function createTempRepoWithWorktree(branch = 'wt-e2e') {
  const repoDir = mkdtempSync(join(tmpdir(), 'epona-repo-'))
  const git = (...args) =>
    execFileSync('git', ['-C', repoDir, ...args], { stdio: 'pipe' }).toString()
  // Identity + a first commit inline so we don't depend on global git config
  // and `worktree add` has a valid HEAD to base the branch on.
  git('init', '-q')
  git(
    '-c',
    'user.email=e2e@epona.test',
    '-c',
    'user.name=Epona E2E',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init'
  )
  git('branch', branch)
  mkdirSync(join(repoDir, '.worktrees'), { recursive: true })
  const worktreeDir = join(repoDir, '.worktrees', branch)
  git('worktree', 'add', worktreeDir, branch)
  return { repoDir, worktreeDir, branch }
}

// Minimal seeded settings that make the renderer show Settings → Maintenance
// (hasRepos keys off a non-empty clientRepoPath) and make the flush handler
// resolve the repo (it takes dirname(clientRepoPath)). The .csproj need not
// exist — only its directory (the repo root) is used.
export function repoModeSettings(repoDir) {
  return {
    targets: {
      hybrasyl: { mode: 'repo', clientRepoPath: join(repoDir, 'client.csproj') }
    }
  }
}

export function worktreeExists(worktreeDir) {
  return existsSync(worktreeDir)
}
