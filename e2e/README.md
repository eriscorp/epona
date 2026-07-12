# Epona E2E (Playwright + Electron)

End-to-end specs that drive the **built** Electron app via Playwright's
`_electron` launcher. This is the pilot harness — currently two specs.

## Running

```bash
npm run e2e        # builds (electron-vite) then runs all specs
npm run e2e:only   # runs specs against the existing out/ build
```

Local-only for now. CI would need a virtual display (xvfb/headed) and a rebuilt
`da-win32` native module; neither is wired up yet.

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
