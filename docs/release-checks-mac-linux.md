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

### A2 and A3. e2e on Electron 44, and the real settings stay the same (both OS) — HTOO-553, HTOO-543

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
- The desktop file is `epona.desktop`, with `Icon=epona` and `StartupWMClass=epona`. The file name and the window class must agree, or the taskbar shows a generic icon (B8).

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

### B7. The splash spinner (Linux) — HTOO-553

Start Epona (`npm run dev` or the packaged app) and watch the splash. **Expected:** the spinner is a round ring. Linux has no Segoe UI, and with the fallback font the column used to squeeze the spinner into an oval that wobbled as it turned.

### B8. Desktop integration (Linux) — HTOO-38, HTOO-63

1. Install the `.deb` from A6 (`sudo apt install ./dist/<file>.deb`).
2. Start Epona from the application menu. **Expected:** the menu entry shows the square tile icon, and the taskbar shows the same icon for the running window, not a generic one.
3. Remove it afterwards (`sudo apt remove epona`).

### B9. The Hybrasyl client launch (both OS) — HTOO-593, HTOO-594, HTOO-656

1. **macOS:** download `Brigid.app` from a Brigid release. On the Hybrasyl Client tab, in binary mode, pick `Brigid.app`. **Expected:** the path shows as a valid prebuilt binary, and Launch starts Brigid on the selected profile (HTOO-593).
2. Copy the client program and remove its execute bit (`chmod -x`). Pick the copy. **Expected:** the message names `chmod +x`. Pick a Windows `.exe`. **Expected:** the message says that it is a Windows program (HTOO-594).
3. Pick a client program that cannot start, for example an x86_64-only build on Apple Silicon with no Rosetta, or a script with no interpreter. Click Launch. **Expected:** an error that says why, not a launch that does nothing (HTOO-594).
4. In `settings.json`, set `clientPath` to a Windows path such as `C:\DarkAges\Darkages.exe`, then start Epona and launch the client. **Expected:** "Dark Ages folder not set" (HTOO-656).

### B10. Keys, folders and status (both OS; steps 1 and 2 on Windows too) — HTOO-649, HTOO-658, HTOO-659, HTOO-660, HTOO-596

1. On Linux and on Windows, open the Log Pane on the Hybrasyl Client tab. Press Ctrl+R, then Ctrl+Shift+I, then F11. **Expected:** nothing happens: the pane stays open, no DevTools opens, and the window keeps its size and place (HTOO-649).
2. In Settings, click Reveal settings folder, and in Report Issue click the logs folder button. **Expected:** the folder opens. On a Linux desktop with no handler for folders (start Epona with `XDG_DATA_HOME`, `XDG_DATA_DIRS` and `XDG_CONFIG_DIRS` pointed at empty folders, as L6 did), a notice names the folder instead (HTOO-658).
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

## Owed elsewhere — not on this page

These checks are for any OS, or for Windows, and are listed here so that they are not lost. Report each on its card.

- **Theme walk (any OS), HTOO-572:** on each of the eight themes (Settings → Theme), check the title bar, the toolbar below it, the tabs, a filled button and its hover, and the "You're running this" chip in What's New. Danaan, Grinneal, Shattered and Untamed have a dark title bar with light, outlined text; Hybrasyl and Chadul have light outlined text; Mundanes and Dubhaimid are flat. No bar text is engraved. The close button turns red under the pointer. The toolbar below the title bar has a different colour from the title bar, and the client status and the toolbar icons are easy to read. On the six Dark Ages themes, the Stop Server button shows the error colour. Then open Settings → Theme → Theme gallery and look at each section in each theme. A settings file that names the retired Spark theme opens in Dubhaimid.
- **Quit prompts (Windows), HTOO-242:** with a repo-mode server running, the title-bar X, Alt+F4 and the in-app X each ask once; Cancel keeps the window and the server; Quit exits with no second question. Closing from the taskbar while minimised restores the window and asks.
- **Server Log Pane (Windows), HTOO-652:** start a repo-mode server, open the pane on the Server tab, and check that the build and start lines arrive. Stop the server: the pane ends with `[epona] The server exited with code …` or, after a Ctrl+C in the console window, `[epona] The server was stopped from its console window.`
- **Portable exe (Windows), HTOO-466 and HTOO-351:** no Setup window flashes on close by the X, Alt+F4 or the taskbar; a second launch brings the first window to the front, also when it is minimised.
- **Signing (Windows, the tag run), HTOO-517:** the release job signs both Windows artifacts on Java 17. Check the `java -version` line, the `[sign] signing … (java: …)` lines and the Verify signatures step.

## For this release (November 2026)

Rewrite this section for each release: what applies, and what is already done. The owed list for this release is the November comment on HTOO-242; tick it there as each check passes.

Everything on this page applies, on Electron 44.10.0, with these parts new since 2.9.0:

- **Part A:** the A2 and A3 notes, and steps 8 and 9 of "Before you start".
- **B3.3:** the Log Pane on the Server tab, the exit notice and Show log (HTOO-589, HTOO-590).
- **B4 steps 6 to 8**, on macOS and on Linux: quit with a repo-mode client and server, Stop on an adopted server, and a server with `config.xml` and a missing log folder.
- **B9 and B10**, on both OS; B10 steps 1 and 2 on Windows too.
- **Part C**, after the tag: C1 with M7, and C2 with L4.
- **The HTOO-627 box scripts** in `docs/plans/01-box-checks/`: `lifecycle.mjs` and `build-and-git.sh` on the Mac and the Linux box, and `m4-dotnet.mjs` on the Mac. Each must print `SUMMARY: PASS`. Then the rest of the HTOO-627 table in `docs/plans/01-macos-linux-deep-dive.md`, against the release's own dmg and AppImage.
- **Windows:** the items in "Owed elsewhere", with the server Log Pane (HTOO-652) and the tag run's Validate step in all three build jobs (HTOO-651).

When the release is published, Sabrael runs `npm run publish:version -- v<version>` on the Windows box. That closes Epona's row on HTOO-382; it is not a Mac or Linux step.
