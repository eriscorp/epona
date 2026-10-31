# 01 — macOS and Linux deep dive (HTOO-627)

Status: code read complete, 2026-10-31. Cards filed as HTOO-641 to HTOO-663; F4 is on HTOO-589, and F10, F12 and F20 are on HTOO-596. The baseline checks have run on the Mac and the Linux box (L2 closed; L7 partial); W2 has run on the Windows box. M7, L4 and W1 are in the end-of-release pass. Owner: Sabrael.

This is the audit that HTOO-627 asks for: Epona's faults on macOS and Linux, found by reading the code, before the fix work package starts. The ten bugs of 2026-10-21 (HTOO-587 to HTOO-596) came from one macOS session and show what that user tried. This document finds the rest and sets the order of the fixes.

**Source:** epona `main` at `4001881`. Six read-only agents audited one area each, as the card lays out. Every finding marked _confirmed_ was checked against the code at that commit. A finding marked **box** needs a real Mac or Linux machine before it is called a fault, and is listed again in [the checks for the box](#checks-for-the-mac-and-the-linux-box). No code was changed.

## Rulings

1. **The audit runs before the house baseline** (Sabrael, 2026-10-31). The release plan puts it after Epona's HTOO-572 PR (#57) and maintenance PR. Neither had merged. Areas 1 to 4 do not overlap them. **#57 merged later the same day** (`cd9f106`). Every finding was re-checked on it and still holds. Line numbers in `App.jsx` and `SettingsPane.jsx` moved: `canToggleLogPane` is at `App.jsx:187`, the optimistic Stop row at `App.jsx:422`, and the placeholder (F20) at `SettingsPane.jsx:818`. Line numbers elsewhere in this document are at `4001881`. Re-check F21 to F28 after the maintenance PR.
2. **The in-app server Log Pane is available on every OS** (Sabrael, 2026-10-31). On macOS and Linux this is HTOO-590 as filed: the server's output is already piped to Epona. On Windows the server keeps its PowerShell console window, which interactive shutdown needs, and the wrapper also tees the output to a file that Epona tails into the pane. That is a new card, F29.

## What the audit found

- **29 new findings**: 3 high, 11 medium, 15 low or low to medium. 9 of them need a box check before they are called faults.
- **Additions to 7 of the 10 existing cards.** HTOO-593 goes from medium to high: Brigid ships on macOS only as `Brigid.app`, so binary mode cannot run the official macOS client.
- **The process lifecycle is the weakest area.** Three faults there hide each other. A directly spawned server that exits on its own never runs its cleanup (F1). Stop on an adopted server can report success and kill nothing (F2). And the status monitor sends an update only when its snapshot changes, while the renderer writes an optimistic "stopped" row, so neither fault ever shows in the UI (F4).
- **The release pipeline tests nothing.** `release.yml` runs no lint and no tests on any of its three jobs, and `ci.yml` says it does (F22). No check ever starts the signed dmg or the AppImage that users download (F23).

## Findings

Each finding gives the place, what goes wrong and where, the severity, and the fix. "Both" means macOS and Linux.

### Area 1 — Process lifecycle

**F1 (HTOO-641). A directly spawned server that exits on its own never runs its launch cleanup.** High. Both. _Confirmed._ `src/main/index.js:945-955`. `wireInstanceLogs`' `onExit` deletes the `instanceChildren` entry and sends `instance:childExit`, but never calls `entry.cleanup()`. On Windows the status monitor's `onReap` does the cleanup (`index.js:1223-1226`), but only for `kind: 'pid'` entries; on macOS and Linux every server is `kind: 'child'`. The Hybrasyl client's exit path runs its cleanup (`index.js:787-796`). The common trigger is a failed repo-mode build. Once the entry is gone, Stop goes to `stopAdoptedInstance` and Reset says "not running", so the cleanup is lost for the session:

- the worktree's refcount stays above 0, so Remove and the orphan sweep treat it as in use;
- the `claimBuildProps` claim stays, so another instance on the same server worktree with a different XML branch is refused with "Another running instance already points…" while nothing runs;
- `Directory.Build.props` stays on disk. For an in-place server repo that is the user's own checkout, where it is gitignored, so their IDE builds silently use the local XML.

**Fix:** run the entry's cleanup from `onExit` when the map still holds this child (await it, log errors). Cover it with a unit test that emits `exit` on a tracked child.

**F2 (HTOO-642). Stop on an adopted server reports success and may kill nothing.** High. Both. _Code confirmed; box for the PIDs._ `src/main/index.js:1243-1259`, `src/main/processKill.js:17-25`, `src/main/portOwner.js:62-64`. `findPortOwner` gets the listener's PID from `lsof`. `killPosixTree` sends `SIGKILL` to `-pid`, the process group with that number. Under `dotnet run`, the listener is the apphost, a child of the `dotnet` muxer that leads the group, so there is plausibly no group with that number. The call fails with `ESRCH`, and `ESRCH` is treated as `{ ok: true }`. Stop returns `wasRunning: true` and sends a made-up exit. The same happens for a server started by hand from a shell. A binary-mode `dotnet x.dll` is its own group leader and is not affected. This is the only recovery path for a server that outlived Epona (a crash, a force quit, or HTOO-592), and F4 hides that it failed.

**Fix:** look up the real group (`ps -o pgid= -p <pid>`) and signal `-pgid`, or fall back to `process.kill(pid)`. Treat `ESRCH` as "already gone" only when `process.kill(pid, 0)` also fails. **Box:** start a repo-mode instance, quit Epona, then run `ps -o pid,ppid,pgid,command -p $(lsof -t -iTCP:<lobbyPort> -sTCP:LISTEN)`. If the PID and the PGID differ, the fault is real. Relaunch, press Stop, and check that the port is still listening.

**F3 (HTOO-644). Quit says it stops the repo-mode Hybrasyl client, and does not, and quit runs no launch cleanup.** Medium. Both; worse on POSIX. _Confirmed._ `src/main/index.js:1370-1372` and `1401` (the prompt lists the client and says "Quitting will stop them and release their git worktrees"), `1552-1579` (`shutdownSweep`). Two agents found this independently.

- `shutdownSweep` goes through `instanceChildren` only. `activeHybrasylChild` is local to `whenReady` (`index.js:769`), and its only `kill()` is at `index.js:895`, when a new launch replaces it.
- `releaseAllWorktrees()` then runs `git worktree remove` on the client's worktree. On Windows open file handles block that. On macOS and Linux nothing does, so the worktree is deleted under the running client.
- The sweep never calls `tracked.cleanup()` for any entry, so `Directory.Build.props` survives every quit. The comment at `index.js:992-996` argues against cleanup on quit and does not consider the build props.

**Fix:** expose a stop hook from `whenReady`, as `confirmStopRepoLaunches` does. The sweep kills the client's tree and waits for it, runs each entry's cleanup after its kill, and only then calls `releaseAllWorktrees`. **Box:** launch the client in repo mode on a pinned branch, quit, then check `ps` for the client and whether `.worktrees/<branch>` still exists.

**F4 (HTOO-589). Status is pushed only on a change, and the renderer writes optimistic rows, so a failed Stop never shows.** Medium. All OSes. _Confirmed._ `src/main/statusMonitor.js:87-96`, `src/renderer/src/App.jsx:396-405`. After a Stop or Reset the renderer writes `running: false`. `refresh()` produces the same snapshot as before and is not sent. The row says "stopped" for as long as the server lives, and the next Start fails with "already appears to be running… use Stop". This hides F2 and HTOO-592.

**Fix:** after every Start, Stop, Reset and child exit, clear the monitor's last snapshot so the next poll always sends. HTOO-589 already asks for this after a start and a child exit, so F4 is a note on that card, which adds Stop and Reset; it is not a card of its own. Put it first in its group, so that the later fixes can be seen working.

**F5 (HTOO-653). Server output is decoded one chunk at a time, so a UTF-8 character split across chunks becomes U+FFFD.** Low. Both (only POSIX pipes the server's output today; Windows too after F29). _Confirmed._ `src/main/lineBuffer.js:9`: `buf += chunk.toString('utf-8')`. **Fix:** use a `StringDecoder`.

### Area 2 — Server target

**F6 (HTOO-645). dotnet discovery takes the first install it finds, not one with .NET 10, and does not set `DOTNET_ROOT`.** Medium. Both. _Order confirmed; box for the effect._ `src/main/dotnet.js:18-37`, `47-60`; `src/main/targets/serverTarget.js:25-34`; `src/main/targets/hybrasylTarget.js:166-168`, `189`.

- On Linux, `/usr/bin/dotnet`, `/usr/lib/dotnet` and `/usr/share/dotnet` come before `~/.dotnet`. On macOS, the pkg and Homebrew paths come before `~/.dotnet`. A distro or Homebrew .NET 8 or 9, with .NET 10 installed into `~/.dotnet` by `dotnet-install.sh` (common on Ubuntu LTS), gives a false "not installed" on the runtime chip and NETSDK1045 on a repo build. The result is cached for the life of the process.
- When nothing matches, the fallback is the bare `dotnet` (`dotnet.js:58`). A Finder- or desktop-launched app does not have the shell's PATH, so the spawn fails with `ENOENT` (HTOO-589, HTOO-594).
- An apphost looks for the runtime through `DOTNET_ROOT` or the global install location. Epona sets neither, for a client apphost in binary mode or for the server apphost that `dotnet run` starts. With .NET only in `~/.dotnet`, the build succeeds and the launch fails with "You must install .NET to run this application", and in binary mode the client's output is ignored, so nobody sees the message.

**Fix:** probe each existing candidate with `--list-runtimes` and `--list-sdks` and take the first one that has .NET 10. When the resolved path is absolute and `DOTNET_ROOT` is unset, set `DOTNET_ROOT` to its real directory in the child's environment. **Box:** a Mac with .NET 10 from Homebrew only, Epona started from Finder (M4).

**Supported installs only** (Sabrael, 2026-10-31). Epona supports the .NET install its hint names, and a mixed install that the hint does not produce is not a fault. On Linux the hint is `sudo apt install dotnet-sdk-10.0`. That install is found first, and apt writes `/etc/dotnet/install_location`, so an apphost finds the runtime with no `DOTNET_ROOT`: L2 is closed. On macOS the hint is `brew install dotnet`, and the hinted install is where F6 plausibly bites. Homebrew writes no `install_location` and tells the user to export `DOTNET_ROOT`, which a Finder-launched app never sees. Discovery also tries `/usr/local/share/dotnet` before Homebrew, so an older pkg install there wins over a brew .NET 10. F6 stays, as a macOS card.

**F7 (HTOO-646). A branch worktree with no XML branch builds with the repo root's `Directory.Build.props`.** Medium. All OSes. _Follows from MSBuild's rules; box to confirm._ Epona writes `Directory.Build.props` into a worktree only when the instance has an XML branch (`src/main/buildProps.js`). A worktree lives at `<repo>/.worktrees/<branch>/`, so with no file of its own, MSBuild walks up and imports the one at the repo root. That file is either Epona's, written for an in-place instance with a local XML branch, or a hand-written one from the server's `Directory.Build.props.example` (`UseLocalProtocol`). The branch instance then builds silently against another instance's XML or Protocol.

**Fix:** always write a `Directory.Build.props` at the worktree root. When there is no XML branch, write one that sets nothing and does not import the parent. **Box (any OS):** put a props file at the server repo root, start a branch instance with no XML branch, and run `dotnet msbuild hybrasyl/Hybrasyl.csproj -getProperty:UseLocalProtocol` in the worktree.

**F8 (HTOO-654). `Directory.Build.props` is written with backslashes, and is not XML-escaped.** Low, pending a check. All OSes for the escaping. _Confirmed; box for the effect._ `src/main/buildProps.js:16-31`. `toWindowsPath` runs on every platform, so `/Users/me/xml/src/Hybrasyl.Xml.csproj` becomes `\Users\me\xml\src\Hybrasyl.Xml.csproj`. MSBuild on Unix usually converts it, but if it does not, the `ProjectReference` is dropped and the build fails on missing Hybrasyl.Xml types. Separately, a folder name that contains `&` or `<` makes the file malformed on every OS.

**Fix:** call `toWindowsPath` on win32 only, and XML-escape the value. **Box:** start a repo instance with an XML branch, then run `grep -A2 '"Hybrasyl.Xml"' <worktree>/hybrasyl/obj/project.assets.json`. It must show `"type": "project"`.

**F9 (HTOO-655). On macOS, two branch names that differ only in case share one worktree folder.** Low. macOS. _Confirmed._ `src/main/worktreeManager.js:37-46`, `110-169`. `sanitizeBranchName` keeps the case, and APFS is case-insensitive by default. `Feature/X` and `feature/x` land in the same folder. Adoption matches neither, the stale-folder recovery runs `git worktree repair` against the other branch's worktree, and the launch fails with a misleading "git doesn't recognize it".

**Fix:** add a short hash of the exact branch name to the folder name.

**F10 (HTOO-596). A server published for macOS or Linux (an apphost with no extension) cannot be picked, or run.** Low. Both. _Confirmed._ `src/renderer/src/components/ServerInstancePanel.jsx:261` (the picker allows `dll` and `exe` only), `:362` (the label "Binary Path (.dll or .exe)"), `src/main/targets/serverTarget.js:62-68` (anything that is not `.exe` runs as `dotnet <path>`). The `.dll` route still works. **Fix:** follow the client: `HybrasylClientPanel.jsx:98-104` for the filter and `hybrasylTarget.js:42` for the executable-bit check. Goes with HTOO-596.

### Area 3 — Client targets

**F11 (HTOO-647). A pinned client branch builds the wrong project when the checkout is reached through a symlink.** Medium. Both. _Confirmed._ `src/main/targets/hybrasylTarget.js:143`, `152-154`. `gitToplevel` returns the physical path. `csprojPath` is the path as the user picked it. `relative()` climbs out with `../..`, so `join(worktreePath, …)` points back at the main checkout (the wrong code runs, silently) or at a path that does not exist. `worktreeManager.realRepoPath` already calls `realpath`; this site does not. It applies to anything under `/tmp` or `/var` on macOS, a `~/Repos` that links to another volume, and plausibly Fedora Silverblue, where `/home` is a symlink.

**Fix:** `realpath` the csproj before `relative()`. **Box (optional):** pick the csproj through a symlink, pin a branch, launch, and read the project path in the log pane.

**F12 (HTOO-596). Binary mode accepts a Windows `.exe` on macOS and Linux, and shows it as a valid "Prebuilt binary".** Low to medium. Both. _Confirmed._ `src/main/targets/hybrasylTarget.js:34-36` gives `.exe` the kind `exe` on every OS; `HybrasylClientPanel.jsx:23` shows the green chip. The spawn then fails (`EACCES`, `ENOEXEC`, or a shell exit code 126), and HTOO-594 means the failure is not reported. On the server side, a synchronous throw from a `.exe` rejects the IPC call, and `runBusy` in `ServerInstancePanel.jsx` has no `finally`, so the button stays on "Starting…" until the window reloads (plausible).

**Fix:** off win32, mark `.exe` invalid with "this is a Windows program; pick the macOS or Linux build or its .dll". Add a `finally` to `runBusy`. Goes with HTOO-594 and HTOO-596.

**F13 (HTOO-656). A Windows `clientPath` carried to a Mac or Linux box becomes `DA_ASSET_PATH='.'`.** Low. Both. _Confirmed._ `src/main/targets/hybrasylTarget.js:179-189`. `dirname('C:\\DarkAges\\Darkages.exe')` is `.` under POSIX. The `stat` fails, the fallback keeps `.`, and the client starts with its assets resolved against its own folder. **Fix:** when the `stat` fails, return the same "Dark Ages folder not set" error as the empty case.

### Area 4 — Where things live

**F14 (HTOO-648). The bridge-failure banner gives a Windows log path on every OS.** Medium. Both. _Confirmed._ `src/renderer/src/components/BridgeErrorBanner.jsx:17`: `'%LOCALAPPDATA%\\Erisco\\Epona\\logs'`. The real folders are `~/Library/Application Support/Erisco/Epona/logs` and `~/.config/Erisco/Epona/logs`. The banner appears only when IPC is dead, which is when the printed path is the user's only route to the logs. **Fix:** choose the text from `window.sparkAPI.platform`, which is a preload property and still works when IPC is down, with `navigator.platform` as a fallback if `sparkAPI` itself is missing.

**F15 (HTOO-657). The Dark Ages installer, about 208 MB, is kept after a successful install, in the config folder.** Low to medium. Both. _Confirmed._ `src/main/index.js:1031`, `1096-1108`; `src/main/daInstaller/installerDownload.js:331-341`. Nothing removes `DarkAges-installer.exe` after the install. It sits in `~/.config` on Linux and `~/Library/Application Support` on macOS, both of which get backed up. This cache exists only for the macOS and Linux install path (HTOO-288). **Fix:** delete the installer and its `.meta.json` once `verifyClientTree` passes; keep them only when the install fails, so it can resume.

**F16 (HTOO-658). "Reveal settings folder", "Reveal logs" and the Report Issue folder button fail silently.** Low. Mainly Linux. _Silence confirmed; box for the trigger._ `src/main/index.js:697` returns `shell.openPath`'s error, which nothing reads. `src/main/diagnostics.js:133-134` discards it. The renderer ignores both (`App.jsx:186-187`, `SettingsPane.jsx:607`, `ReportIssueDialog.jsx:88-90`). On a desktop with no handler for folders, the click does nothing. The server panel's log-folder button does show its error (`ServerInstancePanel.jsx:315-319`). **Fix:** return `{ ok, error }` and show a snackbar that names the path.

### Area 5 — The interface

**F17 (HTOO-649). Off macOS, Electron's default menu stays in place, so Ctrl+R reloads, Ctrl+Shift+I opens DevTools, and F11 goes full screen.** Medium. Linux and Windows. _Code confirmed; box for the keys._ `src/main/index.js:556-582`. `applyAppMenu` returns early when the platform is not darwin, and nothing calls `Menu.setApplicationMenu(null)`. The comment says the default menu "does not show". It does not, because the window is frameless, but its accelerators plausibly stay registered. Ctrl+R throws away the log pane and the renderer state, which is why `appMenu.js:88-92` leaves reload off the Mac menu. DevTools opens in a packaged build. F11 is live because `fullscreenable: false` is set on macOS only; on Linux (Cinnamon, X11) the window keeps its fixed size, but the page is drawn wider than the window and cut off until F11 is pressed again (L3). Nothing in `src/` intercepts these keys.

**Fix:** off darwin, call `Menu.setApplicationMenu(null)`; Chromium handles copy and paste in text fields on its own. **Box:** on Linux and on Windows, press Ctrl+R with the log pane open, then Ctrl+Shift+I, then F11.

**F18 (HTOO-659). The profile caption says "No redirect (official servers)" while the Hybrasyl client is sent to that host anyway.** Low. All OSes; it is the main launch surface on macOS and Linux. _Confirmed._ `src/renderer/src/components/ProfileSelector.jsx:29-31`; `src/main/targets/hybrasylTarget.js:190-192` sets `DA_HOST` whenever the profile has a hostname and ignores `redirect`. The redirect checkbox in the profile dialog is a legacy-patcher setting that does nothing on macOS and Linux. **Fix:** for `targetKind="hybrasyl"`, always show `hostname:port`. Off Windows, hide or relabel the redirect checkbox.

**F19 (HTOO-660). The nav toolbar says the assets are found whenever a path is set.** Low. Both. _Confirmed._ `src/renderer/src/components/NavToolbar.jsx:24`, `35-37`. Off Windows the toolbar shows "Assets: <name>" as found for any non-empty `clientPath`, while the Legacy tab's chip (`LegacyAssetsPanel.jsx:25`) checks the folder and can say "Not found". **Fix:** use the same `inspectAssetDir` result. HTOO-572 changes the colour in this file; this is the status logic, so expect a small merge at most.

**F20 (HTOO-596). The world-folder placeholder is a Windows path with doubled backslashes.** Low. All OSes. _Confirmed._ `src/renderer/src/components/SettingsPane.jsx:800`: `placeholder="C:\\Hybrasyl\\world"`. A JSX attribute string does not process escapes, so the field shows two backslashes on every OS. **Fix:** a per-platform placeholder. Goes with HTOO-596.

### Area 6 — Packaging and release

**F21 (HTOO-650). The macOS entitlements allow code injection into the signed, notarized app.** Medium (security). macOS. _Confirmed._ `build/entitlements.mac.plist:9-12`, applied to the app and every helper by `electron-builder.yml:227-228`. `allow-dyld-environment-variables` together with `disable-library-validation` lets `DYLD_INSERT_LIBRARIES=/any.dylib` load unsigned code into the shipped binary. That is the "set an env var, get code execution" route the `runAsNode` fuse exists to close (`electron-builder.yml:10-16`). electron-builder's default entitlements do not include the DYLD key, and nothing in the repo uses it. It came in with `c47116f` (2026-06-24).

**Fix:** remove `allow-dyld-environment-variables`. Remove `disable-library-validation` too unless something needs it; the only native addon is never loaded on macOS. **Box:** on a signed tag build, run B1 and check that `codesign -d --entitlements - Epona.app` no longer lists the keys.

**F22 (HTOO-651). The tag workflow runs no lint and no tests, and CI's comment says it does.** Medium. All OSes. _Confirmed._ `.github/workflows/release.yml`: the Windows, Linux and macOS jobs run `npm ci`, the build, the packaging and `verify:fuses`, and nothing else. `.github/workflows/ci.yml:60-61` says "release.yml … still validates at tag time". `ci.yml` is `workflow_dispatch` only. So the POSIX halves of the unit suite (`processKill`, `hybrasylTarget`, `index.darwin`, `windowSecurity`) run only when someone dispatches CI or runs checklist A1, and A1 runs after the release.

**Fix:** add `npm run validate` to each build job in `release.yml`. If that is not wanted, correct the comment and move A1 before the tag.

**F23 (HTOO-643). No check ever starts the dmg or the AppImage that users download.** High. Both. _Confirmed for the gap; box for the effect._ `docs/release-checks-mac-linux.md:83-121`, `141-145`. A4, A5 and B1 to B5 use a local, unsigned `--dir` build. On Linux they use `linux-unpacked` and the `.deb`. Nobody opens the signed, notarized, hardened-runtime dmg (`release.yml:296-324`), and nobody builds or starts the `.AppImage` (`electron-builder.yml:271-275`). Hardened-runtime and entitlement faults show only on a signed build. The AppImage needs `libfuse2`, which Ubuntu 22.04 and later do not install by default. And on Ubuntu 24.04 with `kernel.apparmor_restrict_unprivileged_userns=1`, an Electron AppImage plausibly aborts at the sandbox check (the `.deb` installs an AppArmor profile; the AppImage has none).

**Fix:** add two checks after the tag. **Published dmg:** download it from the release, run `spctl -a -vv --type open --context context:primary-signature <dmg>` and `xcrun stapler validate <dmg>`, copy the app to `/Applications`, and launch it as in B1. **AppImage:** `chmod +x` it, launch it on the Linux box and on a stock Ubuntu 24.04, and record whether it needed `libfuse2` and whether it hit a sandbox error.

**F24 (HTOO-643). A2 and A5 pass on Linux Mint, which may hide a stock-Ubuntu sandbox failure.** Medium. Linux. _Plausible; box._ `docs/release-checks-mac-linux.md:59`, `112-119`. `npm run e2e` runs `node_modules/electron/dist/electron`, and A5 runs `linux-unpacked/epona`. Neither has a SUID `chrome-sandbox` or an AppArmor profile. On Ubuntu 24.04 with the userns restriction on, both plausibly abort. **Fix:** a "Before you start" note: on Ubuntu 24.04 or later, run `sysctl kernel.apparmor_restrict_unprivileged_userns`, and if it is on, record that and run the check with `--no-sandbox`.

**F25 (HTOO-661). AppImage children may inherit Epona's library environment.** Low to medium. Linux. _Plausible; three agents raised it; box._ Every spawn passes `{ ...process.env }`: `hybrasylTarget.js:189`, `serverTarget.js:183`, `:228`, and the git and dotnet spawns. electron-builder's AppRun exports `LD_LIBRARY_PATH=$APPDIR/usr/lib`, `GSETTINGS_SCHEMA_DIR`, an `XDG_DATA_DIRS` prefix and a `PATH` prefix (`node_modules/app-builder-lib/out/targets/appimage/appImageUtil.js:192-195`). dotnet, git and the client may then load libraries from Epona's mount, and those paths are gone once Epona exits. **Fix:** when `APPIMAGE` is set, remove these variables from the environment given to children. **Box:** run the AppImage and start the client; run `tr '\0' '\n' < /proc/<child pid>/environ | grep -E 'LD_LIBRARY_PATH|APPDIR'`.

**F26 (HTOO-662). The checklist and the build comments are stale in eight places.** Low. _Confirmed._ One card, with docs only:

- `docs/release-checks-mac-linux.md:5` says the tracker is "in the document repo" without naming it; it is `Comhaigne/tracker/`.
- Step 4, `npm install-scripts ls`, needs npm 12; the `.nvmrc` Node 24 bundles npm 11. Add "`npm --version` must be 12 or later".
- B5 copies an unsigned app to another Mac, where quarantine blocks it. Add `xattr -dr com.apple.quarantine Epona.app`.
- A3 prints UNCHANGED when `sha256sum` is missing, because both hash lists are empty. Check that `before.txt` is not empty.
- `ci.yml:135-142` says a plain `npm ci` "fails outright" off Windows; the stub compiles (`addon.cc:324`) and `release.yml` runs a plain `npm ci`.
- `electron-builder.yml:219-224` says the stub is "byte-identical across arches"; both slices get the host-arch stub. Harmless, because the load is gated on win32.
- `docs/release-process.md:117` names the dmg `Epona-x.y.z-*.dmg`; it is `epona-x.y.z.dmg`. `README.md:164` says "dmg + zip"; there is no zip. `e2e/README.md:12-14` and `CLAUDE.md` say e2e is "Windows only"; A2 runs it on macOS and Linux.
- B3.3 records "Log Pane … greyed out elsewhere" as expected; HTOO-590 changes that.

**F27 (HTOO-662). Two packaging tests can pass for the wrong reason.** Low. _Confirmed._

- `scripts/verify-fuses.test.mjs:266-271` looks for `mac-universal`, `mac` and `linux-unpacked`. A host-arch build (`mac-arm64`, `mac-x64`, `linux-arm64-unpacked`) is skipped, and the test is still green.
- `release.yml:317-318` hard-codes `dist/epona-${VERSION}.dmg`. `release-artifacts.test.mjs` does not pin it against `dmg.artifactName`, so a rename breaks the tag run at the signing step. **Fix:** glob `dist/*.dmg` there, or add the assertion.

**F28 (HTOO-663). On Linux, the window icon is the star while the installed icon is the square tile.** Low, cosmetic. _Plausible; box._ `src/main/index.js:337` sets the window icon to `resources/epona-icon-256.png`, the star. The `.deb` and the hicolor set use the tile. A desktop that does not match the window to the installed `.desktop` file shows the star: the AppImage without desktop integration, and some X11 window lists. **Decide** which icon Linux should show, then check it on the AppImage under X11 and Wayland.

### New work from the rulings

**F29 (HTOO-652). Windows: show the server's output in the Log Pane too.** Medium. Windows. From ruling 2. `src/main/targets/serverTarget.js:161-189`. The wrapper starts the server with `Start-Process` in a new PowerShell window and returns only its PID, so Epona never sees the output. Keep the window. Tee the server's output to a file in the instance's log folder, tail that file into `instance:log`, and show the pane on the Server tab. **Risk:** interactive shutdown needs the server's stdin to stay a console. Piping stdout through `Tee-Object` should leave stdin alone, but only the Windows box can show that. Needs F5 first.

## Additions to the existing cards

**HTOO-589** (status stuck on Stop):

- A spawn `'error'` with no `'exit'` (`ENOENT`, `EACCES`) leaves the entry tracked forever, with `exitCode` null. Start says "already running". Stop waits the full 5 s, runs the cleanup, returns success, and never deletes the entry.
- The likeliest trigger off Windows is the bare `dotnet` fallback in a Finder-launched app (F6), or a missing working folder.
- Fix it with F4: the forced status push is the same change.

**HTOO-590** (Log Pane):

- Ruling 2. This card covers macOS and Linux; F29 covers Windows.
- The tooltip to replace is at `ServerInstancePanel.jsx:696`.
- The only route to a server's log on macOS and Linux today is to open the pane on the Hybrasyl tab in repo mode and then switch tabs (`App.jsx:423-439`).
- B3.3 in the checklist changes (F26).

**HTOO-592** (Stop signals only `dotnet run`):

- Stop (`index.js:1308-1310`) and Reset (`:1348`, `:1356`) run `cleanup()` even when `raceChildExit` timed out. On POSIX nothing locks the files, so `git worktree remove` deletes the worktree under the live server.
- `killPosixTree` is SIGKILL only. If the fix moves Stop onto it, add a SIGTERM and a grace period first.
- The server's own shutdown sleeps 2 s (server `hybrasyl/Game.cs:200-224`). The quit sweep's limit is also 2 s, and it waits for each instance in turn. Raise the limit, and stop the instances in parallel.
- The fix must also cover the adopted path (F2), where the PID comes from `lsof` and is not the group leader.

**HTOO-593** (`.app` refused): raise to **high**.

- Brigid ships for macOS only as `Brigid.app` (`Brigid/Build/macos/make-app.sh` and its `release.yml`). Binary mode cannot run the official macOS client at all.
- Spawn `Contents/MacOS/<CFBundleExecutable>` directly. `open -a` would drop the `DA_*` environment variables.

**HTOO-594** (spawn errors not reported):

- **Repo mode:** `launch` also returns `success: true` with `pid` undefined (`hybrasylTarget.js:213-219`). The `[spawn error]` line goes only to the log pane, which may be closed, and the exit cleanup does not run until the next launch.
- **Gatekeeper:** a quarantined, un-notarized apphost or `.app` is blocked at exec (plausible), which is a further binary-mode trigger.
- **Missing execute bit:** a client unzipped from a GitHub artifact loses `+x`. It gets "path must be an executable, .dll, or .csproj file" with no `chmod +x` hint (`hybrasylTarget.js:42-50`).
- **Server side:** the `runBusy` part of F12 (no `finally`, so the button stays on "Starting…").

**HTOO-595** (`--config` takes the file name): on Linux, `listServerConfigs` accepts `.XML` (`serverConfigs.js:115-117`), but the server lists `*.xml` case-sensitively (xml `src/Extensions/HybrasylEntity.cs:72`). `Local.XML` is offered and never loaded. Match `.xml` case-sensitively off macOS and Windows.

**HTOO-596** (Windows wording):

- **More text:** the field label "Binary Path (.dll or .exe)" (`ServerInstancePanel.jsx:362`); the tooltip "own console window" (`:696`); the placeholder (F20).
- **Task Manager on Linux:** `index.js:1250`, "Stop it from Task Manager", is reached on Linux whenever `lsof` is missing (`portOwner.js:62-64`), which is the default on Arch and minimal Fedora. Add an `ss -ltnp` fallback, and name `lsof` in the message.
- **Pickers:** the server apphost (F10) and the client `.exe` (F12).
- **Leave as is:** `AboutDialog.jsx:33`, `39` is joke text and should stay. It is listed here so the card's sweep knows about it.

HTOO-587, HTOO-588 and HTOO-591: nothing missed.

## Fix order

The card asks for a fault that hides other faults to go first. Three of those come first, in this order, because every later fix is checked through them.

1. **What the user can see.** HTOO-590 (the pane on macOS and Linux) and F4 (status is always pushed after a Start, Stop, Reset or exit), with HTOO-589 (the renderer handles `childExit` and spawn `'error'`). After this, a failed start shows its output and a failed Stop shows "running".
2. **The lifecycle.** F1 (cleanup on exit; **moved to group 1**, see below), HTOO-592 (group kill with a SIGTERM grace period, no cleanup after a timeout, a longer quit limit), F2 (the adopted Stop), F3 (the quit sweep). One PR if it stays reviewable: they share `index.js`, `instanceManager.js` and `processKill.js`, and the tests for one exercise the others.
3. **The server launch.** HTOO-595 (`--config` and `.xml` case), HTOO-587 and HTOO-588 (the log folder), F6 (dotnet discovery and `DOTNET_ROOT`), HTOO-591 (Rosetta), F7 and F8 (build props) after their box checks.
4. **The client launch.** HTOO-593 (`.app`, now high), HTOO-594 with F12 (spawn errors, `.exe`, `runBusy`), F11 (symlinks), F13.
5. **Security and release.** F21 (entitlements) and F22 (tests on the tag). Both are small, and either can go earlier, but F21 is verified only on a signed build, so it rides the release's tag.
6. **The interface.** HTOO-596 with F10 and F20, F14 (the banner), F17 (the default menu, after its box check), F18, F19, F16, F15, F9, F5.
7. **Windows.** F29 (the server's output in the pane), after F5.
8. **The docs.** F26, F27, and the new checks from F23 and F24, last, so that they describe the code as it ships.

**F1 moved to group 1** (2026-10-31). `wireInstanceLogs`' `onExit` compared the tracked entry, `{ kind, value, cleanup }`, with the child, so it never deleted the entry: a server that exited on its own stayed tracked, and the next Stop ran its cleanup. HTOO-589 needs that untrack, and with the untrack and no cleanup on exit, the cleanup could never run. So group 1 takes F1 too: the exit untracks the entry and runs a run-once cleanup, which Stop and Reset await. Group 2 keeps HTOO-592, F2 and F3.

**Group 2** (HTOO-592, HTOO-642, HTOO-644):

- `killProcessTree` on POSIX finds the PID's real process group with `ps`, and never signals Epona's own group. It sends SIGTERM, waits up to 5 s while any process in the group lives, then sends SIGKILL and waits 2 s. "Already gone" needs the PID gone too. A group that outlives SIGKILL is a failure.
- `stopChild` replaces `raceChildExit`. It ends a tracked child through `killProcessTree` and waits for its `exit`. Stop and Reset run no cleanup after a failed stop, and the instance stays tracked. A Reset that cannot stop the server does not relaunch it.
- The quit sweep stops the repo-mode client (through a hook from `whenReady`) and every server in parallel, runs each launch's cleanup after its own kill, and only then releases the worktrees. A repo-mode client is `detached` on POSIX, so its group holds the client that `dotnet run` starts.
- The M3 step of `lifecycle.mjs` calls `stopChild`, and passes only when the listener is gone and the port is free at the moment Stop returns.

**Group 3** (HTOO-595, HTOO-587, HTOO-588, HTOO-646, HTOO-654, HTOO-645, HTOO-591):

- HTOO-595: Epona passes the picked file to `--configFile`, not a name to `--config`. The file's `Name`, its case and the case of `.xml` do not matter. The server took `--configFile` in the same commit as `--logDir` (`9b169383`). The `.XML` case note on the card needs no change: the server loads the one file.
- HTOO-587 and HTOO-588: the launch creates the log folder after its preflights and names the folder when it cannot. Save Log creates it before the dialog. The folder picker has `createDirectory`.
- F7 (HTOO-646): a branch worktree with no local XML gets a `Directory.Build.props` that sets nothing, and a claim like a redirect's. An in-place launch writes nothing. F8 (HTOO-654): the path is XML-escaped, with backslashes on Windows only. `build-and-git.sh` M5 now checks Epona's file and prints PASS or FAIL. On Windows, real MSBuild gave M5 and M6 PASS.
- F6 (HTOO-645): a binary-mode apphost off Windows gets `DOTNET_ROOT` from `dotnet --list-runtimes`, .NET 10 first, when `DOTNET_ROOT` is unset and `dotnet` has an absolute path. `m4-dotnet.mjs` M4.2 spawns with it.
- HTOO-591: on macOS, an output line with "Bad CPU type in executable" or MSB6003 with `(86)` adds one stderr line, `[epona] The build needs Rosetta…`, which the exit notice quotes. No probe before the launch, so a build that needs no x86_64 tool still starts.

### Where the work is done, and when the boxes check it

Sabrael approved this on 2026-10-31.

- **The fixes are built on the Windows box.** It has the full gate, e2e, the `da-win32` rebuild and signing, and the Windows work (F29, F17). CI runs the unit suite on Ubuntu and macOS (`unit-posix`), and the Linux box replaces the WSL run (`npm run validate:linux`) for anything more (Sabrael, 2026-10-31). Each PR records its Windows checks and leaves the macOS and Linux rows owed, as the release plan says.
- **Before the work starts, each box runs every check it can, as the baseline** (Sabrael, 2026-10-31). That is every check below except M7, W1 and L4, which test a released build or a fix. L5 and L7 use a local `npm run build:linux` AppImage.
- **The boxes run the scripts again in the pre-release pass, not after each group** (Sabrael, 2026-10-31). `01-box-checks/lifecycle.mjs` covers group 2 (the lifecycle), on the Mac and the Linux box: mocked tests on Windows cannot show process groups and signals, and HTOO-642 is a fault that a passing unit test did not catch. `01-box-checks/build-and-git.sh` covers group 3 (the server launch). Each must print `SUMMARY: PASS`. The real-process tests in `processKill.test.js` run on every PR in `unit-posix`, so CI catches a group-kill fault before then.
- **The pre-release pass runs the whole table again** on both boxes, against the release's own dmg and AppImage, with the two scripts, and adds M7, L4 and W1.

The scripts print PASS or FAIL against the fixed behaviour, and exit 1 on a FAIL. On `main` at `a1a2d16` they print M1 FAIL, M3 PASS and M6 FAIL (the `R&D` folder). M2 and M5 test git and MSBuild, which no fix changes, so they print FACT; unit tests in epona check the HTOO-644 and HTOO-646 fixes.

## Checks for the Mac and the Linux box

Each one settles a finding marked **box**. They run on the Mac and the Linux box in Sabrael's office before the fixes start, and again after them, as [the schedule above](#where-the-work-is-done-and-when-the-boxes-check-it) sets out. A check that does not confirm its finding closes that card. M7, L4 and W1 test a released build or a fix, so they run only in the end-of-release pass.

### Mac

| Check | For | Steps |
| --- | --- | --- |
| M1 | F2 | Start a repo-mode instance, quit Epona, then run `ps -o pid,ppid,pgid,command -p $(lsof -t -iTCP:<lobbyPort> -sTCP:LISTEN)`. Note whether the PID and the PGID differ. Relaunch Epona, press Stop on the adopted row, and check whether the port still listens. |
| M2 | F3 | Launch the client in repo mode on a pinned branch. Quit Epona and confirm. Check `ps` for the client, and whether `.worktrees/<branch>` still exists. |
| M3 | HTOO-592 | Start a repo-mode server and stop it. Check `ps` for a surviving Hybrasyl process and `lsof -iTCP:2610-2612`. |
| M4 | F6 | Install .NET 10 the way Epona's hint says, `brew install dotnet`, with no pkg install in `/usr/local/share/dotnet`, and do not export `DOTNET_ROOT`. Start Epona from Finder. Check the runtime chip, start a repo-mode instance, and launch a binary-mode client apphost. A "You must install .NET" failure confirms the `DOTNET_ROOT` half. |
| M5 | F7 | Put a `Directory.Build.props` with `UseLocalProtocol` at the server repo root. Start a branch instance with no XML branch, and run `dotnet msbuild hybrasyl/Hybrasyl.csproj -getProperty:UseLocalProtocol` in its worktree. |
| M6 | F8 | Start a repo instance with an XML branch. Run `grep -A2 '"Hybrasyl.Xml"' <worktree>/hybrasyl/obj/project.assets.json`. It must say `"type": "project"`. |
| M7 | F21, F23 | On the next tag: download the dmg from the release, then run `spctl -a -vv --type open --context context:primary-signature` and `xcrun stapler validate`. Install it to `/Applications`, launch it, and run `codesign -d --entitlements - /Applications/Epona.app`. |

### Linux

| Check | For | Steps |
| --- | --- | --- |
| L1 | F2, HTOO-592 | M1 and M3 on Linux. |
| L2 | F6 | **Closed, not run.** It needed .NET 8 from apt beside .NET 10 in `~/.dotnet`, which Epona's hint (`sudo apt install dotnet-sdk-10.0`) does not support (Sabrael, 2026-10-31). The hinted install works: see the Linux results. |
| L3 | F17 | In the packaged app, open the Log Pane in repo mode. Press Ctrl+R, then Ctrl+Shift+I, then F11. Note what each does. Repeat on the Windows box. |
| L4 | F23, F24 | End of release, on the Mint box: there is no stock Ubuntu machine (Sabrael, 2026-10-31). Mint 22.3 is built on Ubuntu 24.04 and differs here only in leaving `kernel.apparmor_restrict_unprivileged_userns` at 0, so set it as stock Ubuntu does: `sudo sysctl kernel.apparmor_restrict_unprivileged_userns=1` (until reboot). `chmod +x` the release's AppImage and launch it, then run A2. Note any sandbox error. Set it back to 0 after. The `libfuse2` half is not measured: Ubuntu 22.04 and later do not install `libfuse2` (`libfuse2t64` on 24.04) and Mint does, so the checklist states it, with `--appimage-extract-and-run` as the alternative. Untested: any other difference in stock Ubuntu's package set. |
| L5 | F25 | Under the AppImage, start the client and a server. Run `tr '\0' '\n' < /proc/<child pid>/environ \| grep -E 'LD_LIBRARY_PATH\|APPDIR'`. |
| L6 | F16 | On a desktop where `xdg-mime query default inode/directory` prints nothing, click "Reveal settings folder". |
| L7 | F28 | Launch the AppImage under X11 and under Wayland, and look at the taskbar icon. |

### Windows

| Check | For | Steps |
| --- | --- | --- |
| W1 | F29 | With the tee in place, start a server and check that interactive shutdown still works in the console window. |
| W2 | F17 | L3 on Windows. |

### Results on the Mac (2026-10-31)

macOS 27, Apple Silicon, epona `main` at `a1a2d16`, server `6ed8d59a`, .NET 10.0.12 in `/usr/local/share/dotnet`. The checks run from two scripts in [`01-box-checks/`](01-box-checks/), which drive Epona's own modules against a real repo-mode server (`lifecycle.mjs`) or build throwaway projects (`build-and-git.sh`). Run the same two scripts on the Linux box for L1 and the Linux half of M2, M5 and M6.

| Check | Card | Result |
| --- | --- | --- |
| M1 | HTOO-642 | **Confirmed.** The listener (the `Hybrasyl` apphost) is a child of `dotnet run` in its process group, and is not the leader: PID 12008, PPID and PGID 12001. `killProcessTree(12008)` returns `{ ok: true }`, and the server keeps listening. The group also holds the Roslyn compiler server (`VBCSCompiler`), which a kill by group takes down too; that is harmless. |
| M2 | HTOO-644 | **Confirmed.** A non-force `git worktree remove` deletes a worktree that holds ignored build output while a process runs from it, with a file open. The process keeps running with a deleted working folder. |
| M3 | HTOO-592 | **Not reproduced on macOS.** Stop's SIGTERM to `dotnet run` reaches the server: `dotnet run` exits with code 143 within 30 ms, and the port is free within 1 s. No orphan. The card's other parts stand (cleanup after a timeout, SIGKILL only, the adopted path is HTOO-642). L1 decides it for Linux. |
| M4 | HTOO-645 | **Narrowed and confirmed** (run later the same day, after swapping the `dotnet-sdk` cask for the `dotnet` formula; `01-box-checks/m4-dotnet.mjs` under `env -i` with launchd's PATH). The formula's `/opt/homebrew/bin/dotnet` is an env script that sets `DOTNET_ROOT` and runs `libexec/dotnet`. Discovery and the runtime chip pass, and the repo-mode server builds and listens, because `dotnet run` and the server inherit the script's `DOTNET_ROOT`. A framework-dependent client apphost in binary mode **fails**: exit 131, "You must install .NET to run this application". The official Brigid releases are self-contained (Brigid `release.yml`), so they are not affected. **The fix on the card was wrong:** `dirname(realpath(dotnet))` gives the env script's `bin`, and the apphost still fails. The root from `dotnet --list-runtimes` (`…/libexec`) works. |
| M5 | HTOO-646 | **Confirmed.** A project under `<repo>/.worktrees/<branch>/` imports the repo root's `Directory.Build.props`: it sees `UseLocalProtocol=true`. |
| M6 | HTOO-654 | **Half cleared.** MSBuild on macOS resolves Epona's backslash `LocalXmlProjectPath` (restore gives `Hybrasyl.Xml` as `project`, and the build succeeds), so the backslashes are cosmetic. The escaping half is **confirmed**: under a folder named `R&D`, restore reports no error and silently drops the reference. |
| M7 | HTOO-650, HTOO-643 | Waits for the next tag. |

### Results on the Linux box (2026-10-31)

Linux Mint 22.3 (Ubuntu 24.04 base), kernel 7.0, Cinnamon on X11, epona `main` at `b72f5d7`, server `6ed8d59a`, .NET 10.0.113 from apt in `/usr/lib/dotnet`. `kernel.apparmor_restrict_unprivileged_userns` is 0. The same two scripts ran for L1 and the Linux half of M2, M5 and M6. L3 and L6 ran on a fresh `--linux --dir` package (2.9.0, fuses verified), and L5 and L7 on a local AppImage, with keys and clicks sent through XTEST to the focused Epona window.

| Check | Card | Result |
| --- | --- | --- |
| L1 (M1) | HTOO-642 | **Confirmed.** As on the Mac: the listener (the `Hybrasyl` apphost, PID 5954) is a child of `dotnet run` and in its group, PPID and PGID 5774, with `VBCSCompiler` in the same group. `killProcessTree(5954)` returns `{ ok: true }`, and the server keeps listening. |
| L1 (M3) | HTOO-592 | **Not reproduced on Linux.** `dotnet run` exits with code 143 within 135 ms of Stop's SIGTERM, and the port is free within 1 s. No orphan. The card's other parts stand, as on the Mac. |
| M2 | HTOO-644 | **Confirmed.** Same as the Mac: the worktree is removed, and the process keeps running. |
| M5 | HTOO-646 | **Confirmed.** The worktree project sees `UseLocalProtocol=true` from the repo root. |
| M6 | HTOO-654 | **Same as the Mac.** The backslash path resolves on Linux (`project`); under `R&D` the reference is silently dropped (`none`). |
| L2 | HTOO-645 | **Closed:** an unsupported install (see F6). This box has the hinted install, .NET 10 from apt: `resolveDotnetPath()` returns `/usr/bin/dotnet`, the runtime chip reads ".NET 10 runtime + SDK", and in L1 the server's apphost found its runtime with no `DOTNET_ROOT`. |
| L3 | HTOO-649 | **Confirmed, all three keys.** With the Log Pane open on the Hybrasyl tab: **Ctrl+R** reloads the renderer; the pane closes and the window shrinks back to 480 px (nothing in `src/` handles the key). **Ctrl+Shift+I** opens DevTools, docked inside the 480 px window, in the packaged build. **F11** does not go full screen: the window keeps its size, and the WM sets no `_NET_WM_STATE_FULLSCREEN`. But Electron drops the frameless window's shadow inset, so the page is drawn wider than the window and the toolbar is cut off on the right until F11 is pressed again. W2 is still owed. |
| L5 | HTOO-661 | **Confirmed, with less effect than feared, and a new fault (below).** Run as a local `npm run build:linux` AppImage, which launched with no extra packages: Mint ships `libfuse2`. Start Server from the UI. The server process (`Hybrasyl`) has `LD_LIBRARY_PATH=/tmp/.mount_epona-…/usr/lib`, `APPDIR`, `APPIMAGE`, `GSETTINGS_SCHEMA_DIR`, and `PATH` and `XDG_DATA_DIRS` prefixed with the mount, and so do `dotnet run` and `VBCSCompiler`. That folder holds only GUI libraries (`libappindicator`, `libnotify`, `libXss`, `libXtst` and two more), and the server mapped none of them. The client was not started, because its saved branch is missing on this box. |
| L6 | HTOO-658 | **Confirmed.** Epona started with `XDG_DATA_HOME`, `XDG_DATA_DIRS` and `XDG_CONFIG_DIRS` pointed at empty folders, so `xdg-mime query default inode/directory` prints nothing. Settings → About → "Reveal settings folder": `gio` prints "Failed to find default application for content type 'inode/directory'" on Epona's stderr, and the window shows nothing. |
| L7 | HTOO-663 | **Partial.** On X11 the AppImage's taskbar entry is the square tile, but only because the `.deb` from B8 is installed: its `epona.desktop` has `StartupWMClass=epona`, which the window's `WM_CLASS` matches. The window's own `_NET_WM_ICON` is the star. The case F28 is about, an AppImage with no installed desktop file, needs the `.deb` removed first. This box has no Wayland session. |

**Found on the way: every child inherits Epona's open files, so under the AppImage a build server keeps the mount alive after Epona quits.** Added to HTOO-661. After L5, closing Epona left the AppImage runtime running, and its mount still up. `fuser -m` named `VBCSCompiler`, the Roslyn build server that the server's `dotnet run` starts and that outlives it (re-parented to PID 1). Its open files include `resources/app.asar`, `icudtl.dat`, `v8_context_snapshot.bin`, `resources.pak`, the two `chrome_*_percent.pak` and `locales/en-US.pak`, all inside the mount. Chromium opens those without close-on-exec, and `spawn` does not close them, so each child, and each child of a child, keeps them. `dotnet build-server shutdown` released the mount, and the runtime exited within 3 s. Left alone, it lasts until the build server's idle timeout. On the `.deb` it is only a leak of descriptors into `/opt/Epona`. **Fix:** open the child's descriptors with close-on-exec, or start children through a helper that closes every descriptor above 2. Check the Windows side too, since a handle inherited there would lock `app.asar` against an update.

**Found on the way: logs nested in `logs/logs`.** `config.xml`, `qa.xml` and the local `local.xml` in the world repo gave each log a `Destination` of `logs/<Name>-.log`. The server joins it onto `--logDir`, so with Epona's default `<world>/logs` the logs went to `<world>/logs/logs/`. Sabrael ruled that logs are not nested there. `config.xml` is fixed in world PR #192 (`local.xml` too, locally); `qa.xml` waits for a check of the QA server's `--logDir` (WLD-85).

### Results on the Windows box (2026-10-31)

Windows 11, 150% display scaling, a packaged `npm run build:unpack` of epona `main` at `3c95bdf` (unsigned), on a copy of Sabrael's settings under a scratch `LOCALAPPDATA`. Keys and clicks went through `user32` to the focused Epona window, with a screenshot after each step.

| Check | Card | Result |
| --- | --- | --- |
| W2 | HTOO-649 | **Confirmed, all three keys, and F11 is worse than on Linux.** With the Log Pane open on the Hybrasyl tab: **Ctrl+R** reloads the renderer; the pane closes and the window shrinks from 1282 to 742 physical px (480 px). **Ctrl+Shift+I** opens DevTools in the packaged build, docked inside the window. **F11** moves the window to the top-left corner of the primary display, at its own size, without the shadow inset, and the title bar draws dark, so the wordmark and the window buttons barely show. A second F11 puts the window back, 1 px wider and taller (743 × 1212 against 742 × 1211). The fix needs `fullscreenable: false` on every platform, as well as `Menu.setApplicationMenu(null)`. |

## Checked and fine

The agents also recorded what holds on macOS and Linux, so that the coverage is visible:

- **Lifecycle:** the port probes use a plain TCP connect, not `netstat`. `findPortOwner` uses `lsof`, which is on the macOS GUI PATH. No `tasklist`, `wmic` or PowerShell is reached off Windows. On macOS, closing the window does not quit, and `activate` restores the status. On Linux, closing the window asks before it stops repo launches. The quit order is correct.
- **Server:** the args, the case of `serverconfigs` and the csproj names on disk, the Redis and dotnet install hints, `stdin: 'ignore'` (so the server's `ReadKey` on a fatal error does not block), the worktree `realpath`, and the macOS Command Line Tools detection.
- **Client:** the Legacy launch cannot be reached off Windows. `da-win32` is never loaded there, and its stub exports nothing. Wine is declined on purpose. The repo-mode logs are piped and line-buffered.
- **Paths:** userData is `~/Library/Application Support/Erisco/Epona` and `~/.config/Erisco/Epona`. The roaming migration is gated on win32. The pickers fall back to Documents and then home. `portableSweep` runs only in the portable build. Packaged files are resolved from `__dirname`.
- **Interface:** there are no Ctrl shortcuts in the renderer, and every accelerator is `Cmd+` in the macOS menu. The help and install hints are per OS. The macOS title bar and menu are correct. The update notice links to the release page, which lists the dmg, the deb and the AppImage.
- **Packaging:** `release-artifacts.test.mjs` pins the dmg, deb and AppImage in both directions. The signing scripts skip themselves off Windows. The universal app has exactly two identical `.node` files. `linux.icon` is a directory, and `syncDesktopName` is set. The checklist's counts (A2: 29 tests; macOS 28 passed and 1 skipped; Linux 24 and 5) match the suite.

**Not covered by any check yet** (for the end-of-release pass to decide): the Intel slice of the universal app, which nothing ever starts; the `.deb`'s dependencies on a current Ubuntu or Debian, since B8 ran on Mint only; Wayland, for the frameless title bar's drag and the taskbar icon; and Linux arm64, which is not built.
