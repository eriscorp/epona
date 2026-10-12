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
cmp "$T/before.txt" "$T/after.txt" && echo UNCHANGED
ls -d "$S"     # a folder that did not exist before must not exist now
```

If `sha256sum` is missing, use `shasum -a 256`.

Expected for A2 (29 tests in 15 files):

- **macOS:** 28 passed and 1 skipped. The five tests in `app-menu.spec.js` run on macOS only; they cover the menu, Go, Check for Updates and About. The skip is the title-bar close in `quit.spec.js`, because a window close does not quit on macOS. `title-bar.spec.js` expects a 78 px left padding on macOS.
- **Linux:** 24 passed and 5 skipped. The skips are `app-menu.spec.js`.
- On Windows the result is also 24 passed and 5 skipped.

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

On a Linux box with no display, start it under `xvfb-run -a`.

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

On each of the six themes (Settings → Theme): the stoplights sit centred in the bar, and the bar holds nothing else, with no logo and no name. The green stoplight does not put the window in full screen: the window has a fixed size.

### B3. The application menu (macOS) — HTOO-242, HTOO-382

1. **Epona menu:** About Epona opens the About dialog with the Settings pane closed. Check for Updates… opens Settings with the About section expanded; its button says that Epona is up to date, or names a newer version (HTOO-382). Settings… (⌘,) opens the Settings pane.
2. **File:** Locate Assets… (⌘O) opens the folder picker. Reveal Settings Folder and Reveal Logs Folder open Finder at the settings folder and its `logs` folder.
3. **View:** Log Pane is available on the Hybrasyl Client tab in repo mode, and greyed out elsewhere, except while the pane is open: then it is available on every tab and closes the pane.
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

### B5. Missing Command Line Tools (macOS, only if such a Mac is available) — HTOO-512

This needs a Mac that has no Command Line Tools. Do not remove the tools from the Mac that runs Part A. Copy the packaged app from A4 to that Mac; it cannot run `npm ci` itself.

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

## Owed elsewhere — not on this page

These checks are for any OS, or for Windows, and are listed here so that they are not lost. Report each on its card.

- **Theme walk (any OS), HTOO-341:** on Hybrasyl, the scrollbar thumb, the log-pane toggle, the install progress bar and the busy spinners are visible; filled buttons keep their teal; the other five themes look as before.
- **Quit prompts (Windows), HTOO-242:** with a repo-mode server running, the title-bar X, Alt+F4 and the in-app X each ask once; Cancel keeps the window and the server; Quit exits with no second question. Closing from the taskbar while minimised restores the window and asks.
- **Portable exe (Windows), HTOO-466 and HTOO-351:** no Setup window flashes on close by the X, Alt+F4 or the taskbar; a second launch brings the first window to the front, also when it is minimised.
- **Signing (Windows, the tag run), HTOO-517:** the release job signs both Windows artifacts on Java 17. Check the `java -version` line, the `[sign] signing … (java: …)` lines and the Verify signatures step.

## For this release (2.9.0)

Rewrite this section for each release: what applies, and what is already done.

**macOS: done** on 2026-10-11 (macOS 27.0.1, Apple Silicon, epona `66ffa71`). A1 to A5, B1, B2, B3 and B6 pass, with every count as this page expects; the results are on each card and summed up on HTOO-242. B4 and B5 were skipped by Sabrael's decision: tests cover both, and a fault would come in as a complaint.

**Linux: to do.** A1 to A6 and B6 to B8. A2 expects 24 passed and 5 skipped. For B6, record the case of the client file names exactly as they are on disk (HTOO-287, HTOO-288).

**Windows:** the items in "Owed elsewhere" are not done yet.

When the release is published, Sabrael runs `npm run publish:version -- v2.9.0` on the Windows box. That closes Epona's row on HTOO-382; it is not a Mac or Linux step.
