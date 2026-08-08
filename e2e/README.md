# Epona E2E (Playwright + Electron)

End-to-end specs that drive the **built** Electron app via Playwright's
`_electron` launcher. This was the house pilot for the pattern; it is now the
regression net for the things unit tests structurally cannot reach — real window
geometry, the packaged file layout, the OS sandbox, and the IPC wiring.

## Running

```bash
npm run e2e        # builds (electron-vite) then runs all specs
npm run e2e:only   # runs specs against the existing out/ build
```

**Windows only, locally and in CI.** `ci.yml` runs the whole suite as its own
job on `windows-2022`: it rebuilds `da-win32`, builds the app, and runs every
spec below. No virtual display is involved — the job is Windows and headed.

The suite is not part of the `ubuntu-latest` / `macos-latest` unit job, and is
not meant to be: the specs need the native addon and a built app.

## Specs

- **`settings-offset.spec.js`** — measures the "opening Settings indents the UI"
  bug instead of eyeballing it. It reads the native window geometry (main
  process) and the on-screen left edge of the Epona title + "Client: …" status
  (renderer), and asserts nothing shifts when Settings toggles. This is what
  root-caused the bug: not a native client-area letterbox (that measured 0) but
  MUI `Toolbar` responsive gutters flipping at the 600px viewport breakpoint when
  the window widens. Fixed by `disableGutters` on both toolbars.
- **`flush-worktrees.spec.js`** — stands up a temp git repo with one managed
  worktree, seeds repo-mode settings, drives Settings → Maintenance → Flush, and
  asserts the worktree is actually gone from disk. Guards the once-shipped
  no-op-flush regression (the missing `await` in the flush handler).
- **`settings-persistence.spec.js`** — changes the theme, waits for the write to
  reach disk, relaunches against the same userData dir, and asserts the theme
  hydrated. Full renderer → IPC → disk → reload round-trip.
- **`theme-switch.spec.js`** — switches through all six themes in the real app,
  asserts no `pageerror`, the app stays mounted, and the background changes
  (catches theme-object regressions jsdom unit tests miss).
- **`multipane-geometry.spec.js`** — companion to the offset spec: the same
  content-origin invariant while the Log pane and Settings pane open (window
  480 → 840 → 1200px).
- **`content-overflow.spec.js`** — the same family, pinning the **right** edge.
  The other two geometry specs pin the left origin, which is how a 29px overflow
  shipped unnoticed: every origin was stable and the content was simply wider
  than the viewport it had been given. Guards the window-coordinate vs
  content-coordinate distinction in `window:resize`, which is not visible in the
  source and is easy to "simplify" back.
- **`preload-sandbox.spec.js`** — asserts the bridge survives `sandbox: true`.
  Nothing about this is visible at build time: a preload that imports a package
  beyond `electron` builds fine, links fine, and then throws in the packaged app,
  taking the whole UI with it. `src/preload/index.test.js` now makes the same
  assertion statically, in milliseconds; this one proves it against a real build.
- **`ipc-guard.spec.js`** — the unit tests in `src/main/windowSecurity.test.js`
  prove the _policy_ against fakes. This proves the _wiring_: that `guardIpc`
  actually wraps `ipcMain`, so a handler registered on the raw import cannot
  quietly opt out of the sender check.
- **`whats-new.spec.js`** — What's New renders the `CHANGELOG.md` packaged beside
  the app, which ships only because `electron-builder.yml`'s `files` allowlist
  names it. That is a packaging fact no unit test can reach. Also the regression
  guard for `app.getAppPath()`, which returns the wrong directory under this
  harness — a future edit "simplifying" the path resolution back to it fails here
  instead of shipping.
- **`worktree-sweep.spec.js`** — the startup sweep collects worktrees stranded by
  a branch switch or a deleted instance, and must never take one with
  uncommitted work in it.

## Gotchas (learned the hard way)

- **`ELECTRON_RUN_AS_NODE`** — if this env var is set in your shell, Electron
  boots as plain Node (no `app`, no windows) and the main process crashes at
  `app.setPath`. `launchEpona` strips it from the child env; don't re-add it.
- **Splash window** — Epona shows a splash before the main window, so
  `electronApp.firstWindow()` can grab the wrong one. `getMainWindow` finds the
  real window by the presence of `window.sparkAPI` (the splash has no preload).
- **Hidden until ready** — the main window stays hidden until the renderer
  signals `app:ready`; `getMainWindow` waits for `isVisible()` before measuring.
- **Hermetic userData** — `launchEpona` points `%LOCALAPPDATA%` at a temp dir so
  runs don't touch the real profile. Pass `seedSettings` to preload a config.
- **Test the built app** — specs launch `out/main/index.js`. Rebuild after
  changing `src/` or you'll test stale code. `npm run e2e` does this for you.
- Don't spawn real servers/clients (dotnet) in specs — drive UI + filesystem
  only.
