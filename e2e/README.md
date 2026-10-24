# Epona E2E (Playwright + Electron)

End-to-end specs that drive the **built** Electron app via Playwright's `_electron` launcher. This was the house pilot for the pattern; it is now the regression net for the things unit tests structurally cannot reach — real window geometry, the packaged file layout, the OS sandbox, and the IPC wiring.

## Running

```bash
npm run e2e        # builds (electron-vite) then runs all specs
npm run e2e:only   # runs specs against the existing out/ build
```

**Windows only, locally and in CI.** `ci.yml` runs the whole suite as its own job on `windows-2022`: it rebuilds `da-win32`, builds the app, and runs every spec below. No virtual display is involved — the job is Windows and headed.

The suite is not part of the `ubuntu-latest` / `macos-latest` unit job, and is not meant to be: the specs need the native addon and a built app.

## Specs

- **`settings-offset.spec.js`** — measures the "opening Settings indents the UI" bug instead of eyeballing it. It reads the native window geometry (main process) and the on-screen left edge of the Epona title + "Client: …" status (renderer), and asserts nothing shifts when Settings toggles. This is what root-caused the bug: not a native client-area letterbox (that measured 0) but MUI `Toolbar` responsive gutters flipping at the 600px viewport breakpoint when the window widens. Fixed by `disableGutters` on both toolbars.
- **`flush-worktrees.spec.js`** — stands up a temp git repo with one managed worktree, seeds repo-mode settings, drives Settings → Maintenance → Flush, and asserts the worktree is actually gone from disk. Guards the once-shipped no-op-flush regression (the missing `await` in the flush handler).
- **`settings-persistence.spec.js`** — changes the theme, waits for the write to reach disk, relaunches against the same userData dir, and asserts the theme hydrated. Full renderer → IPC → disk → reload round-trip.
- **`theme-switch.spec.js`** — switches through all six themes in the real app, asserts no `pageerror`, the app stays mounted, and the background changes (catches theme-object regressions jsdom unit tests miss).
- **`theme-gallery.spec.js`** — opens Settings → Theme → Theme gallery, selects each of the six themes, and reads every contrast ratio the gallery measures (HTOO-572). jsdom cannot measure a MUI v9 button, so this runs in Chromium. It fails when a sample cannot be measured. It does not fail on a low ratio: it writes each one to `theme-gallery.json` in the test's output folder, for review.
- **`title-bar.spec.js`** — reads the house title bar's padding and buttons from the built app: 24 px each side and two window buttons (no Maximize, the window has a fixed size) on Windows and Linux, an empty bar padded 78 px on macOS.
- **`multipane-geometry.spec.js`** — companion to the offset spec: the same content-origin invariant while the Log pane and Settings pane open (window 480 → 840 → 1200px).
- **`content-overflow.spec.js`** — the same family, pinning the **right** edge. The other two geometry specs pin the left origin, which is how a 29px overflow shipped unnoticed: every origin was stable and the content was simply wider than the viewport it had been given. Guards the window-coordinate vs content-coordinate distinction in `window:resize`, which is not visible in the source and is easy to "simplify" back.
- **`preload-sandbox.spec.js`** — asserts the bridge survives `sandbox: true`. Nothing about this is visible at build time: a preload that imports a package beyond `electron` builds fine, links fine, and then throws in the packaged app, taking the whole UI with it. `src/preload/index.test.js` now makes the same assertion statically, in milliseconds; this one proves it against a real build.
- **`ipc-guard.spec.js`** — the unit tests in `src/main/windowSecurity.test.js` prove the _policy_ against fakes. This proves the _wiring_: that `guardIpc` actually wraps `ipcMain`, so a handler registered on the raw import cannot quietly opt out of the sender check.
- **`whats-new.spec.js`** — What's New renders the `CHANGELOG.md` packaged beside the app, which ships only because `electron-builder.yml`'s `files` allowlist names it. That is a packaging fact no unit test can reach. Also the regression guard for `app.getAppPath()`, which returns the wrong directory under this harness — a future edit "simplifying" the path resolution back to it fails here instead of shipping.
- **`worktree-sweep.spec.js`** — the startup sweep collects worktrees stranded by a branch switch or a deleted instance, and must never take one with uncommitted work in it.
- **`csp-header.spec.js`** — the CSP is a response header from main, not only a meta tag (HTOO-467). It reads the header off the main document and the splash document through the DevTools protocol, and asserts exactly one `Content-Security-Policy` header with the value of `RENDERER_CSP` or `SPLASH_CSP`. It asserts that the renderer boot and the splash write no `Refused to …` CSP message to the console, that the splash logo loads, and that a remote image is refused. It never hooks `onHeadersReceived`: that hook keeps one listener per session, so a spec that hooked it would remove the app's own CSP.
- **`nav-pages.spec.js`** — opens every tab, the Settings drawer and the theme gallery in the built app, and asserts each panel marker, no `error-boundary-fallback` and no `pageerror`, named per page (HTOO-393). The tab list is `TAB_ORDER`, read as text from `App.jsx`, so a new tab needs only its `tab-<kind>` and `page-<kind>` ids. It waits 250 ms after each click, so a fault that comes shortly after mount shows on its own page and not on the next one. `src/renderer/src/rendererNodeGlobals.test.js` is its source-level partner: it fails on a `process`, `Buffer`, `require`, `__dirname` or `__filename` read in renderer code, and names the file.

## What automation cannot reach

Each item below is a check that a person does by hand, and the reason the suite cannot do it.

- **The CSP in `npm run dev`, and DevTools under it (HTOO-467).** Every spec runs the built app with no `ELECTRON_RENDERER_URL`, so it sees the packaged policy only. The dev server gets `DEV_RENDERER_CSP`, because `@vitejs/plugin-react` injects an inline script. To check it: run `npm run dev`, confirm the window renders with no `Refused to` message in its console, and open DevTools. DevTools must render, because the header hook does not police `devtools:`.
- **A Node global read on a path that the e2e profile does not render (HTOO-393).** The main window runs `sandbox: true`, so `process`, `Buffer`, `require`, `__dirname` and `__filename` do not exist in the renderer, and a read of one throws `ReferenceError`. vitest runs in Node and supplies all five, so no unit or jsdom test can see the fault. `nav-pages.spec.js` sees it only on a path that renders: the e2e profile is empty, so a read inside a server instance's sub-tabs (Server, Xml, Config, Network), a launch result or an error branch does not run. `rendererNodeGlobals.test.js` reads the source and covers those paths. A platform fact the renderer needs comes from main through `window.sparkAPI`; do not read a global in the preload to answer it a second way.
- **The CSP in the packaged exe (HTOO-467).** The suite runs `out/` under a plain Electron, not the asar in the portable exe. The document is a `file:` URL in both, so the policy is the same. To check it: start the portable exe, and confirm the splash logo, the fonts and the app all show.

## Gotchas (learned the hard way)

- **`ELECTRON_RUN_AS_NODE`** — if this env var is set in your shell, Electron boots as plain Node (no `app`, no windows) and the main process crashes at `app.setPath`. `launchEpona` strips it from the child env; don't re-add it.
- **Splash window** — Epona shows a splash before the main window, so `electronApp.firstWindow()` can grab the wrong one. `getMainWindow` finds the real window by the presence of `window.sparkAPI` (the splash has no preload).
- **Hidden until ready** — the main window stays hidden until the renderer signals `app:ready`; `getMainWindow` waits for `isVisible()` before measuring.
- **Hermetic userData** — `launchEpona` points `%LOCALAPPDATA%` at a temp dir so runs don't touch the real profile. Pass `seedSettings` to preload a config.
- **Test the built app** — specs launch `out/main/index.js`. Rebuild after changing `src/` or you'll test stale code. `npm run e2e` does this for you.
- Don't spawn real servers/clients (dotnet) in specs — drive UI + filesystem only.
