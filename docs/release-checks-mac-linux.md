# Mac and Linux release checks

This page is for an agent that runs on the Mac or the Linux box at the end of an Epona release, and for the person at that machine. The Windows checks are done on the Windows dev box during the work, and [release-process.md](release-process.md) lists the packaged-build checks done at release time. This page covers what only macOS or Linux can show.

Each check names the tracker card it reports to. The tracker is in the document repo (`tracker/issues/HTOO/`). Follow the writing conventions in that repo's `AGENTS.md`: commit straight to `main`, one commit per card, message `tracker: HTOO-<n> comment`, stage only paths under `tracker/`, set `updated` to the real time, and push at once. A check with no card of its own reports to the Epona epic, HTOO-242.

## Before you start

1. Make sure that the box has a C++ toolchain: on macOS the Xcode Command Line Tools (`xcode-select -p` prints a path), on Linux `build-essential`. `npm ci` compiles the `da-win32` addon on every OS; off Windows it builds a stub, but it still needs a compiler.
2. Pull `main` and do a clean install:

   ```bash
   git checkout main && git pull --ff-only
   npm ci
   ```

3. Make sure that the Electron binary is present. `npm ci` runs `install-electron` through `postinstall`. If `node_modules/electron/dist` is missing, run `npx install-electron`.
4. `npm install-scripts ls` must print `No packages with unreviewed install scripts.` On macOS this is where a missing `fsevents` approval shows, because only macOS installs it (HTOO-542). Report anything it lists; do not approve it yourself.
5. Make sure that `ELECTRON_RUN_AS_NODE` is not set. Some agent shells set it, and then Electron runs as plain Node. Run `unset ELECTRON_RUN_AS_NODE` in each shell that builds, packages or runs e2e.
6. Use Node 24 (`.nvmrc`).
7. Quit any running Epona. A3 hashes the real settings folder, and a running copy changes files there.
8. `npm --version` must be 12 or later, because step 4's `npm install-scripts ls` is an npm 12 command and Node 24 comes with npm 11 (`npm install -g npm@12`). node-gyp also needs `python3` on the PATH.
9. **Linux:** run `sysctl kernel.apparmor_restrict_unprivileged_userns`. On Ubuntu 24.04 and later it is 1 by default, and Chromium's sandbox then aborts an unpackaged Electron (HTOO-643). If it is 1, say so in the report, run A2 with `EPONA_E2E_NO_SANDBOX=1 npm run e2e`, and start A5 with `--no-sandbox`. Linux Mint leaves it at 0.

## How to report

- Record each result as a comment on the card that the check names. Give the date, the OS and version, the commit (`git rev-parse --short HEAD`), the command, and what you saw.
- A failure is a comment too. Copy the exact output. Do not change the code in the same session unless Sabrael asks.
- Do not change a card's status yourself. Sabrael moves the cards after the results are in.
- Some checks need a person to look at the window. You cannot see the window, so ask the person at the machine to do those steps, and record their answer.

## Part A: commands the agent runs

### A1. The gate (both OS)

```bash
npm run validate && npm run build
```

`validate` runs `lint:check`, `format:check` and the unit suite. Epona has no `typecheck`: it is JavaScript. Every step must pass. Report the test count.

If a `dist/` folder from an earlier package exists, the packaged-artifact case in `scripts/verify-fuses.test.mjs` reads it, and a package older than the current `electron-builder.yml` fails it. Delete `dist/` first, or run A4 and then this step again.

### A2 and A3. e2e on Electron 45, and the real settings stay the same (both OS) — HTOO-553, HTOO-543

A2 runs the e2e suite (HTOO-553). A3 proves that the suite does not touch the real settings (HTOO-543): the e2e helper points `LOCALAPPDATA` at a temp folder, and Epona reads `LOCALAPPDATA` on every OS. The helper also stops the run if the app's `userData` is not under the temp folder. One e2e run serves both, and it rebuilds the app first, so do not run it twice.

The real settings folder:

| OS    | Settings                                      |
| ----- | --------------------------------------------- |
| macOS | `~/Library/Application Support/Erisco/Epona/` |
| Linux | `~/.config/Erisco/Epona/`                     |

```bash
unset ELECTRON_RUN_AS_NODE
S="<settings dir from the table>"
T=$(mktemp -d)
ls -d "$S"     # say in the report whether it exists
find "$S" -type f -exec sha256sum {} + 2>/dev/null | sort > "$T/before.txt"
npm run e2e
find "$S" -type f -exec sha256sum {} + 2>/dev/null | sort > "$T/after.txt"
[ -s "$T/before.txt" ] || echo "EMPTY: no hash tool, or no settings folder"
cmp "$T/before.txt" "$T/after.txt" && echo UNCHANGED
ls -d "$S"     # a folder that did not exist before must not exist now
```

If `sha256sum` is missing, use `shasum -a 256`. Two empty lists also compare as `UNCHANGED`, so an `EMPTY` line means that A3 checked nothing: fix the hash command, or say that the settings folder did not exist.

Expected for A2 (30 tests in 16 files):

- **macOS:** 29 passed and 1 skipped. The five tests in `app-menu.spec.js` run on macOS only; they cover the menu, Go, Check for Updates and About. The skip is the title-bar close in `quit.spec.js`, because a window close does not quit on macOS. `title-bar.spec.js` expects a 78 px left padding on macOS, and 24 px at the right (the house title bar, HTOO-572).
- **Linux:** 25 passed and 5 skipped. The skips are `app-menu.spec.js`.
- On Windows the result is also 25 passed and 5 skipped.

A different total means that a spec was added or was not collected. Say so in the report.

e2e opens and closes its own windows. It needs a desktop session but no clicks. On a Linux box with no display, use `xvfb-run -a npm run e2e`.

Expected for A3: `UNCHANGED`, and no new folder.

### A4. The fuses on a packaged build (both OS) — HTOO-374, HTOO-381

The mac and Linux builds must skip the Windows-only addon rebuild, so each command overrides `beforeBuild`, as `build:mac` and `build:linux` do.

On macOS, build an unsigned universal app, without notarization:

```bash
npm run build
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir --universal \
  -c.mac.notarize=false --config.beforeBuild=scripts/noop-before-build.cjs
npm run verify:fuses -- dist/mac-universal/Epona.app
```

`--universal` is required. `--dir` replaces the configured targets, and without an arch flag it builds only the host's architecture (`dist/mac-arm64/` on Apple Silicon), which has one wire.

Expected: `Electron fuses OK on dist/mac-universal/Epona.app (2 wires)`. There is one wire for each slice (x64 and arm64), and each wire shows the five fuses as the yml sets them, including `EnableEmbeddedAsarIntegrityValidation=ENABLE`. With no Developer ID certificate, electron-builder prints `skipped macOS application code signing`. That is expected.

On Linux:

```bash
npm run build
npx electron-builder --linux --dir --config.beforeBuild=scripts/noop-before-build.cjs
npm run verify:fuses -- dist/linux-unpacked/epona
```

Expected: one wire. The reader checks all five fuses on Linux too: electron-builder sets the asar integrity fuse there, and Linux does not enforce it.

### A5. The packaged app gets past the asar check (both OS) — HTOO-381

With the asar integrity fuse on, a damaged package exits with no window and no message. The only signs of the failure are a non-zero exit and `ASAR Integrity Violation` on stderr, so start the binary from the terminal. Point it at a temp folder so that it does not write the real settings:

```bash
T=$(mktemp -d)
BIN=dist/mac-universal/Epona.app/Contents/MacOS/Epona   # Linux: dist/linux-unpacked/epona
LOCALAPPDATA="$T" "$BIN" 2>"$T/stderr.txt" &
P=$!; for i in $(seq 1 10); do kill -0 $P 2>/dev/null || break; sleep 1; done
kill -0 $P 2>/dev/null && { echo "RUNNING after 10s"; kill $P; } || { wait $P; echo "EXITED $?"; }
grep -i integrity "$T/stderr.txt"
```

On a Linux box with no display, start it under `xvfb-run -a`. With the sandbox restriction from step 9 on, add `--no-sandbox` after `"$BIN"`.

Expected: `RUNNING after 10s`, and no integrity line. B1 then checks what the window shows.

### A6. The Linux deb payload (Linux) — HTOO-38, HTOO-63

The release publishes a `.deb`, and its icon set and desktop file have never been read from a real package: `fpm` does not run on Windows.

```bash
npx electron-builder --linux deb --config.beforeBuild=scripts/noop-before-build.cjs
DEB=$(ls dist/*.deb)
dpkg-deb -c "$DEB" | grep -E 'usr/share/icons/hicolor/.*/apps/epona\.png'
dpkg-deb --fsys-tarfile "$DEB" | tar -xO ./usr/share/applications/epona.desktop
```

Expected:

- One `epona.png` for each of the eight hicolor sizes in `build/icons/`, `16x16` to `512x512`. The 256 is the square tile, full-bleed (no light plate around it).
- The desktop file is `epona.desktop`, with `Icon=epona` and `StartupWMClass=epona`. The file name and the window class must agree, or the taskbar shows a generic icon.

## Part B: checks a person does

Use the packaged app from A4 for B1 to B5 on macOS. Use `npm run dev` or the packaged app for the others. Ask the person to do each step and tell you what they saw. Start the packaged macOS app through `open`, with the temp settings folder, so that it does not use the real settings:

```bash
open -n --env LOCALAPPDATA="$(mktemp -d)" dist/mac-universal/Epona.app
```

### B1. The packaged app starts (macOS) — HTOO-381

**Expected:** the splash, then the main window. The menu bar says "Epona" (a dev build says "Electron"; that is not a fault).

### B2. The title bar (macOS) — HTOO-242

On each of the eight themes (Settings → Theme): the stoplights sit centred in the bar, and the bar holds nothing else, with no logo and no name. The green stoplight does not put the window in full screen: the window has a fixed size.

### B3. The application menu (macOS) — HTOO-242, HTOO-382

1. **Epona menu:** About Epona opens the About dialog with the Settings pane closed. Check for Updates… opens Settings with the About section expanded; its button says that Epona is up to date, or names a newer version (HTOO-382). Settings… (⌘,) opens the Settings pane.
2. **File:** Locate Assets… (⌘O) opens the folder picker. Reveal Settings Folder and Reveal Logs Folder open Finder at the settings folder and its `logs` folder.
3. **View:** Log Pane is available on the Hybrasyl Client tab in repo mode and on the Hybrasyl Server tab when an instance is selected, and greyed out on the Legacy Client tab, except while the pane is open: then it is available on every tab and closes the pane. On the Server tab the pane shows the selected instance's output (HTOO-590). Start an instance that cannot start (for example, one whose Server Config names a config that does not exist): a notice names the server and shows its last error line, and Show log opens the pane on that instance. The Start Server button comes back.
4. **Go:** ⌘1, ⌘2 and ⌘3 switch to Legacy Client, Hybrasyl Client and Hybrasyl Server, and the Go menu marks the tab on screen.
5. **Help:** Recommended Installs…, Report an Issue… and What's New open their dialogs.
6. **Over a dialog:** open Report an Issue, then press ⌘2. Nothing changes.
7. **Text fields:** in a text field, ⌘C, ⌘V and ⌘A work, and ⌃K deletes to the end of the line.

### B4. Quit with a running server (macOS) — HTOO-242

This check needs a Hybrasyl server instance in repo mode that starts on the Mac (a server checkout, .NET and Redis). If the Mac has none, say so and skip it.

1. Start the instance. Press ⌘Q. **Expected:** Epona asks before it stops anything. Cancel keeps the window and the server. ⌘Q again, then Quit: the server stops and Epona exits.
2. Start the instance. Minimise the window, then press ⌘Q. **Expected:** the window comes back and Epona asks.
3. Start the instance. Press ⌘W. **Expected:** the window closes with no question, and the server keeps running. Click the Dock icon: the window opens again. Quit from the Dock menu with no window open: Epona asks in a dialog of its own.
4. Hide Epona (⌘H), then Quit from the Dock menu. **Expected:** Epona comes to the front and asks.
5. With the window open, move it to another display or change the display scale. **Expected:** the window keeps its size and fits the display. Do this once more after a ⌘W and a Dock click.
6. Start the instance, and launch the Hybrasyl client in repo mode on a pinned branch. Press ⌘Q, then Quit. **Expected:** the question lists both. Within about 5 seconds the client closes and Epona exits. `ps` shows no process from either launch, and `.worktrees/<branch>` is gone. Do this step on Linux too (HTOO-644).
7. Start the instance, then end Epona with `kill -9`. Open Epona again and press Stop on the instance. **Expected:** the instance shows as stopped, and `lsof -iTCP:<lobbyPort> -sTCP:LISTEN` shows nothing. Do this step on Linux too (HTOO-642).
8. Set the instance's Server Config to `config.xml` (it has no `Name`), and its Log Dir to a folder that does not exist. Start the instance. **Expected:** the server starts, and the log folder exists. Open the Log Pane and click Save Log: the dialog opens in that folder. Do this step on Linux too (HTOO-595, HTOO-587, HTOO-588).

### B5. Missing Command Line Tools (macOS, only if such a Mac is available) — HTOO-512

This needs a Mac that has no Command Line Tools. Do not remove the tools from the Mac that runs Part A. Copy the packaged app from A4 to that Mac; it cannot run `npm ci` itself. The A4 build is not signed, so macOS quarantines the copy: run `xattr -dr com.apple.quarantine Epona.app` on that Mac before you open it.

1. On the Server tab, pick a folder that is a git checkout. **Expected:** the message says to run `xcode-select --install`, not "not a git repository".
2. Open the branch list a few times. **Expected:** the system install dialog does not come back each time.
3. Start a repo-mode instance. **Expected:** the same `xcode-select --install` message, not "not inside a git repository".
4. Install the tools, then press a branch Refresh button or start the instance again. **Expected:** it works, with no restart.

### B6. The Dark Ages installer on a clean machine (both OS) — HTOO-288

1. On the Legacy Client tab, open the Dark Ages install panel. Choose an empty folder as the destination, and let Epona download and unpack the installer.
2. **Expected:** the progress bar moves and the unpack finishes. The panel then shows the folder as a usable client folder.
3. List the folder. It holds the client files, including `Legend.dat`. On Linux, record the case of the names exactly as they are on disk.
4. Choose another empty folder and start an unpack. Kill Epona while it unpacks: a `<folder>.epona-incomplete-<n>` folder stays beside the destination. Start Epona again and unpack into the same folder. **Expected:** the leftover folder is gone (HTOO-462). The sweep removes only leftovers beside the folder it unpacks into.

### B7 and B8. The chrome on Linux: retired

Sabrael retired the Linux chrome checks on 2026-11-02. Tests cover each one, and A1 runs them:

- **The round splash spinner** (B7, HTOO-553): `src/main/splash.test.js` pins `flex-shrink: 0` on the spinner and the logo, and the spinner's equal width and height and `border-radius: 50%`.
- **The menu and taskbar icon** (B8, HTOO-38, HTOO-63): `scripts/icons.test.mjs` pins the eight hicolor sizes, `linux.icon`, the desktop-name pair (`desktopName` and `syncDesktopName`) and the deb's maintainer. A6 still reads the icons and the desktop file from a real `.deb`.
- **The title bar and the toolbar on the eight themes** (HTOO-572), which the theme walk under "Owed elsewhere" covered: `chromeContrast.test.jsx` (the bar text and glyphs, the outline or the flat bar, light text on a decorated bar, the hover and close-hover colours), `tertiary.test.js` (the toolbar differs from the title bar), `NavToolbar.test.jsx` (the client status and the toolbar icons are easy to read, and the open Settings pane has a ring) and `AppTitleBar.test.jsx` (the theme's chrome, and the window buttons wired to the bridge). `e2e/theme-switch.spec.js` applies all eight in the real app.

### B9. The Hybrasyl client launch (both OS) — HTOO-593, HTOO-594, HTOO-656

1. **macOS:** download `Brigid.app` from a Brigid release. On the Hybrasyl Client tab, in binary mode, pick `Brigid.app`. **Expected:** the path shows as a valid prebuilt binary, and Launch starts Brigid on the selected profile (HTOO-593).
2. Copy the client program and remove its execute bit (`chmod -x`). Pick the copy. **Expected:** the message names `chmod +x`. Pick a Windows `.exe`. **Expected:** the message says that it is a Windows program (HTOO-594).
3. Pick a client program that cannot start, for example an x86_64-only build on Apple Silicon with no Rosetta, or a script with no interpreter. Click Launch. **Expected:** an error that says why, not a launch that does nothing (HTOO-594).
4. In `settings.json`, set `clientPath` to a Windows path such as `C:\DarkAges\Darkages.exe`, then start Epona and launch the client. **Expected:** "Dark Ages folder not set" (HTOO-656).

### B10. Keys, folders and status (both OS; steps 1 and 2 on Windows too) — HTOO-649, HTOO-658, HTOO-659, HTOO-660, HTOO-596

1. On Linux and on Windows, open the Log Pane on the Hybrasyl Client tab. Press Ctrl+R, then Ctrl+Shift+I, then F11. **Expected:** nothing happens: the pane stays open, no DevTools opens, and the window keeps its size and place (HTOO-649).
2. In Settings, click Reveal settings folder, and in Report Issue click the logs folder button. **Expected:** the folder opens. Do not test a Linux desktop with no handler for folders: on Linux, Electron reports success when `xdg-open` fails, so no notice shows, and Epona does not support that desktop (HTOO-658, wontfix 2026-11-02).
3. On the Hybrasyl Client tab, select a profile with the redirect off. **Expected:** the caption under the profile names its host and port, not "No redirect". Edit the profile: off Windows there is no redirect checkbox, and the host can be changed (HTOO-659).
4. Point the Dark Ages folder at a folder with no `.dat` files. **Expected:** the toolbar says "Assets Not Found", as the Legacy tab's chip does (HTOO-660).
5. On Linux with no `lsof` installed, start a server, end Epona with `kill -9`, open it again and press Stop. **Expected:** the server stops (Epona finds it with `ss`). The server panel's log-folder tooltip says Finder on macOS and "the file manager" on Linux (HTOO-596).

## Part C: the published build, after the tag — HTOO-643

Part A and Part B use a local, unsigned `--dir` build. Only the release's own files have the signature, the notarization, the hardened runtime and the entitlements that users get, and on Linux only the AppImage runs from its own mount. Do these after the tag run is green, with the files from the GitHub release.

### C1. The published dmg (macOS)

```bash
DMG=~/Downloads/epona-<version>.dmg
spctl -a -vv --type open --context context:primary-signature "$DMG"
xcrun stapler validate "$DMG"
```

**Expected:** `accepted` with `source=Notarized Developer ID`, and `The validate action worked!`. Open the dmg, copy Epona to `/Applications`, and start it from Finder. **Expected:** as in B1, with no Gatekeeper dialog. Then run `codesign -d --entitlements - /Applications/Epona.app` (M7). **Expected:** `allow-jit`, `allow-unsigned-executable-memory` and `disable-library-validation` only, with no `allow-dyld-environment-variables` (HTOO-650).

### C2. The published AppImage (Linux)

```bash
chmod +x ~/Downloads/epona-<version>-x86_64.AppImage
~/Downloads/epona-<version>-x86_64.AppImage
```

**Expected:** the window opens. Then L4: set the sandbox restriction on for this boot (`sudo sysctl kernel.apparmor_restrict_unprivileged_userns=1`), start the AppImage again, and record whether it aborts at the sandbox check. Set it back to its value from step 9 afterwards. Say in the report if the AppImage needed `libfuse2`: Ubuntu 22.04 and later do not install it, and Mint does. Without it, `--appimage-extract-and-run` starts the AppImage. If the AppImage aborts with the restriction on, that is a code card for HTOO-643.

Then L5, the children's environment (HTOO-661). Start a server and launch the client from the AppImage. For each child, run:

```bash
tr '\0' '\n' < /proc/<child pid>/environ | grep -E '^(APPDIR|APPIMAGE|ARGV0|OWD|LD_LIBRARY_PATH|GSETTINGS_SCHEMA_DIR)=|\.mount_'
```

Find the pids with `pgrep -f Hybrasyl` and `pgrep -f Brigid`. **Expected:** no `APPDIR`, `APPIMAGE`, `ARGV0` or `OWD` line, and no line that names `/tmp/.mount_…`. An `LD_LIBRARY_PATH` or `GSETTINGS_SCHEMA_DIR` line is correct only if the session set it before Epona started.

Then the children's open files (HTOO-661, fault 2). With the server running, run `ls -l /proc/<server pid>/fd | grep '\.mount_'`. **Expected:** no output. Quit Epona while `pgrep VBCSCompiler` still finds the build server, and run `mount | grep '\.mount_'`. **Expected:** no output within a few seconds: the AppImage's mount goes away, and the build server keeps running. A mount that stays is a failure; `fuser -m <mount>` names the process that holds it, and `dotnet build-server shutdown` releases it.

## Owed elsewhere — not on this page

These checks are for any OS, or for Windows, and are listed here so that they are not lost. Report each on its card.

- **Theme walk (any OS), HTOO-572:** on each of the eight themes (Settings → Theme), check the tabs, a filled button and its hover, and the "You're running this" chip in What's New. On the six Dark Ages themes, the Stop Server button shows the error colour. Then open Settings → Theme → Theme gallery and look at each section in each theme. A settings file that names the retired Spark theme opens in Dubhaimid. Tests now cover the title bar and the toolbar (B7 and B8).
- **Quit prompts (Windows), HTOO-242:** with a repo-mode server running, the title-bar X, Alt+F4 and the in-app X each ask once; Cancel keeps the window and the server; Quit exits with no second question. Closing from the taskbar while minimised restores the window and asks.
- **Server Log Pane (Windows), HTOO-652:** start a repo-mode server, open the pane on the Server tab, and check that the build and start lines arrive. Stop the server: the pane ends with `— process … ended (signal SIGKILL) —`, because Stop ends the console script with `taskkill /F`, before it can write a line of its own. A server that exits by itself ends with `[epona] The server exited with code …`, and a Ctrl+C in the console window with `[epona] The server was stopped from its console window.`
- **Portable exe (Windows), HTOO-466 and HTOO-351:** no Setup window flashes on close by the X, Alt+F4 or the taskbar; a second launch brings the first window to the front, also when it is minimised.
- **Signing (Windows, the tag run), HTOO-517 and HTOO-686:** the release job signs both Windows artifacts on Java 17. Check that the "Fetch and verify CodeSignTool" step passes (a changed archive stops it with `CodeSignTool archive digest … is not the pinned …`), the `java -version` line, the `[sign] signing … (java: …)` lines and the Verify signatures step.

## For this release (the release after 2.10.0)

Rewrite this section for each release: what applies, and what is already done. The owed list for this release is the 2026-11-17 comment on HTOO-242; tick it there as each check passes.

The release moves Epona to new majors (eriscorp/epona#70, HTOO-694): Electron 45.3.4 (Chromium 156, Node 24.22.3), electron-vite 6 on vite 8, Vitest 5 and jsdom 31. eriscorp/epona#71 also gives each child `/dev/null` in place of Epona's open files on Linux (HTOO-661). No feature changed, so the whole page applies, and the parts below matter most. The 2.10.0 checks for HTOO-627 (N1 to N5, and the box scripts) are done, and are not owed again.

- **"Before you start", step 4:** `npm install-scripts ls` must still print `No packages with unreviewed install scripts.` vite 8 builds with rolldown, which installs a native binding with no install script. esbuild is gone, and so is its approval in `package.json`. On macOS, `fsevents` is still approved.
- **A1:** the suite is on Vitest 5 and jsdom 31. On Windows it is 2117 passed and 17 skipped in 122 files. Report the count; some tests skip by OS, so the count off Windows can differ.
- **A2 and A3:** e2e on Electron 45. The totals in A2 do not change (30 tests in 16 files).
- **A4 and A5, then B1:** the first packaged build on Electron 45 on each OS. An Electron major is the change that a packaged launch exists to check: the fuses, the asar check, and the window.
- **`npm run dev` (both OS):** start it, change a line of text in a renderer file, and save. **Expected:** the window starts, and the change shows without a restart. This is the electron-vite 6 and vite 8 dev server, which no check above starts.
- **B4, B9 and B10 (both OS):** each starts a server, the client, git or dotnet. Every child now gets its environment from `childEnv()`, and on Linux `/dev/null` in place of each of Epona's open files (`childStdio()`, HTOO-661). Off the AppImage the environment does not change, so these must pass as before.
- **A1 on Linux:** two tests in `childStdio.test.js` run on Linux only. They spawn real children and read `/proc`. They must pass, not skip.
- **Part C, after the tag:** C1 with M7, and C2 with L4 and **L5** (HTOO-661, the AppImage's children: their environment, and the mount after Epona quits). L5 is new.
- **Windows:** the items in "Owed elsewhere". The Signing item now includes the "Fetch and verify CodeSignTool" step (HTOO-686). The first tag run is also the first run of the pinned actions and of the read-only permissions: if a step fails with a 403 or "Resource not accessible by integration", report it on HTOO-686.

### Checks for this release only

- **R1. A portable exe that is not Epona's (HTOO-667, Windows).** Done on 2026-11-17 on a `--dir` build of `7e1ff0e`: with Balor's three `PORTABLE_EXECUTABLE_*` values set, Epona ran for 40 s and its session log had no portable line. With `PORTABLE_EXECUTABLE_APP_FILENAME=epona`, the same build logged `unexpected portable layout`, so the log does show a sweep. Not owed on macOS or Linux: the variables come only from the Windows portable stub.
- **R2. The portable exe still cleans up (HTOO-667 and HTOO-494, Windows).** Start the release's own portable exe. In Task Manager, end the stub's process (`epona-<version>-portable.exe`, not `Epona.exe`), then close Epona. Its `%TEMP%\ns*.tmp` folder stays. Wait 10 minutes, start the portable exe again, and wait 30 s. **Expected:** the old folder is gone, and the session log has no `unexpected portable layout` line. This proves that the stub's own `PORTABLE_EXECUTABLE_APP_FILENAME` matches the package name `epona`.

HTOO-663 (the Linux window icon) and HTOO-685 (the renderer's launch authority) stay open.

When the release is published, Sabrael runs `npm run publish:version -- v<version>` on the Windows box. It is not a Mac or Linux step.
