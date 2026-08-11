# Changelog

All notable user-facing changes to Epona are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[Semantic Versioning](https://semver.org/).

<!--
Release process (the notes are authored HERE, not edited on GitHub after the fact):
  1. As you land a PR, add its user-facing change under ## [Unreleased]
     (Added / Changed / Deprecated / Removed / Fixed / Security).
  2. To cut a release: rename ## [Unreleased] to ## [X.Y.Z] - YYYY-MM-DD, add a
     fresh empty ## [Unreleased] above it, and bump package.json to X.Y.Z
     (npm version X.Y.Z --no-git-tag-version).
  3. Tag vX.Y.Z and push. The release workflow runs scripts/changelog-extract.mjs
     to pull THIS version's section into the GitHub release body, then appends the
     auto-generated PR list below it.
Keep entries user-facing — internal refactors/tests show up in the appended auto list.

Write entries in ASD-STE100 Simplified Technical English (asd-ste100.org), like the rest of the
documentation in this repo:
  - One idea per sentence. Keep sentences below about 25 words.
  - Present tense, active voice. Name the actor: "Epona reads the installer", not "the installer
    is read".
  - One term for one thing, through the whole file. Do not reach for a synonym for variety.
  - No idioms, no metaphor, no rhetorical asides. Give the fault, then the behaviour now.
Keep the section order of Keep a Changelog: Added, Changed, Deprecated, Removed, Fixed, Security.
One heading of each kind per version.

Sections before 2.8.0 are in the earlier, more conversational style. They are the text that was
published with those releases, so they stay as they are. 2.8.0 is the first section written to
the rules above.
-->

## [Unreleased]

## [2.8.0] - 2026-08-11

### Added

- **Epona can unpack the Dark Ages client files on every platform.** The official client installer
  is a Windows program. You cannot run it on macOS or Linux. Epona reads that installer and writes
  the client files directly. You do not need Wine, a virtual machine, or any other software. The
  Legacy Client tab asks where to put the files. You can then download the installer from
  darkages.com, or select a copy that you have. Epona shows the progress. You can stop the
  download, and Epona continues it from the same point. Epona compares each file with the checksum
  in the installer as it writes the file. If a run fails, Epona does not change your folder. When
  the check is complete, Epona points itself at the new files. On Windows, Epona shows the same
  controls below the launch controls. On Windows, the official installer stays the usual way to
  install the game. The official installer records Dark Ages in Windows. Epona does not.
- **Epona tells you when a new version is available.** A few seconds after it starts, Epona asks
  GitHub for the most recent release. If a newer release exists, Epona shows a small notice with a
  link to it. If you close the notice, Epona does not show that version again. A later version
  shows a new notice. Epona downloads and installs nothing. If your machine is offline, behind a
  proxy, or rate-limited, Epona shows nothing.
- **`EPONA_DISABLE_GPU` sets the Remote Desktop rendering decision.** Set it to `1` to use software
  rendering on any machine. Set it to `0` to keep hardware acceleration in a session that Epona
  reads as remote. If you do not set it, Epona decides. There is no control for this in the
  interface. The variable is for the condition where the automatic decision is wrong on your
  machine.

### Changed

- **The Legacy Client tab operates on macOS and Linux.** Epona showed the tab in grey, with a
  message that the legacy client needs Windows. That is correct for the launch function. It is not
  correct for the Dark Ages files, because the Hybrasyl client reads its graphics and its sounds
  from those files. The tab now shows your Dark Ages folder. It tells you if it finds the data
  files there. It also lets you change the folder. Windows does not change.

### Fixed

- **Epona does not write its status checks into a running server's log.** Epona opened a
  connection to each server every three seconds to find its status. Hybrasyl reads each connection
  as a player and writes five lines, one of them as an error. A server that ran beside Epona
  collected these lines continuously. Epona already knew the status of a server that it started.
  Epona now opens a connection only when it has no other source for the status. Epona still finds
  a server that started outside Epona.
- **The Remote Desktop adaptation operates when you reconnect to a session.** Windows records how
  a session started, and it does not change that record. If you connect to a machine that you left
  in a logged-in condition, Epona read the session as local. The adaptation in 2.7.2 did nothing
  for the persons who reconnect, and that is most of them. Epona now asks Windows directly, and it
  gets the correct answer in both conditions.
- **Text is clear over Remote Desktop.** Each theme drew a soft shadow behind every letter. A
  remote connection cannot send that shadow correctly, and the text looked unsteady. Epona now
  removes the shadow in a remote session. Epona also uses a simpler letter shape. Nothing changes
  when you use the machine directly.
- **Epona draws its own icon on Linux.** The application menu showed an empty white page, which is
  the generic document icon of the desktop. Epona installed one image of 1024 pixels, and no Linux
  desktop looks for that size. Epona now installs eight standard sizes. Epona also connects its
  windows to the installed entry. The task bar and the window list now show the icon. Windows and
  macOS do not change.
- **`localhost` operates as a Legacy profile host name.** The redirect now asks DNS for an IPv4
  address only. Before this change, a machine that prefers IPv6 got a client that started and
  connected to nothing. You had to type `127.0.0.1` instead. That is no longer necessary.
- **Epona does not start the legacy client when it cannot apply the patches.** Before this change,
  only a failure of the ground-item hints stopped the launch. Any other failure let a partly
  patched client start. An unresolvable host name is one example.
- **Two server instances on one branch do not compete for the local XML redirect.** Instances on
  the same server branch use one working copy. If you started a second instance against a
  different XML branch, Epona changed the build of the first instance. Epona now refuses that
  launch, and it gives the name of both branches. Two instances that need the same XML branch
  still use one working copy. If you stop one of them, the redirect stays for the other.

## [2.7.2] - 2026-08-07

### Added

- **Releases now carry `SHA256SUMS.txt` and a build provenance attestation.** If a
  download is ever flagged, you can check that the bytes you have are the bytes we
  published.
- **A guide for when Windows flags the download**, at
  [docs/antivirus.md](docs/antivirus.md). Defender occasionally reports Epona as
  `Trojan:Win32/Wacatac.C!ml`. It is a false positive — Epona patches the memory of
  the game client it launches, which is its job and also what a scanner looks for.
  The guide covers how to verify a download, how to release it from quarantine, and
  how to report the detection to Microsoft.
- **The Windows installer is documented.** Releases have shipped both
  `epona-x.y.z-setup.exe` and `epona-x.y.z-portable.exe` for some time, but only the
  portable exe was mentioned anywhere. Both are supported; pick whichever you prefer.

### Changed

- **Windows downloads are now signed all the way through.** Previously only the
  outer file carried a signature, so everything the portable exe unpacked was
  unsigned. Every program file in the download is signed now, including the native
  addon, and a release cannot be published if any of them is missed.
- **Epona runs properly over Remote Desktop now.** It detects a remote session and
  adapts on its own — no setting to find. A remote session has no graphics card to
  use, so Epona stops trying to use one and drops the blur effect behind panels,
  which is expensive to draw without one. Dragging the window was laggy and the app
  used noticeable processor time while sitting idle; both are fixed.

### Fixed

- **The window could open far too small over Remote Desktop and refuse to be
  resized.** Epona sizes itself to fit your screen, but a remote session can report
  a nonsense screen size for a moment while connecting, and Epona locked itself to
  it. It now refuses to shrink below a usable size, and re-sizes itself when the
  screen changes — on reconnecting, or when a monitor is added or removed.

## [2.7.1] - 2026-08-01

### Changed

- **Epona has a proper macOS icon.** The Dock and Finder showed the same square
  logo Windows uses, which sits oddly among the rounded icons macOS draws beside
  it. macOS now gets artwork drawn for it, sized to Apple's icon grid.

## [2.7.0] - 2026-08-01

### Added

- **A "What's New" button in Settings → About.** It shows the release notes for
  the version you are running, with the full history below it — no need to go to
  GitHub to find out what changed. The notes ship inside the app, so it works
  offline.

### Changed

- **Epona starts faster, and the splash screen actually shows its logo.** Every
  place the Epona logo appeared — the splash, the title bar, the Settings
  header, the window icon — loaded the same 1024×1024, 1.7 MB image, to draw it
  as small as 20 pixels across. On a cold start that decode landed on the
  splash's first paint, which is the one thing the splash exists to make fast.
  Each spot now loads an image sized for what it actually draws.

- **Smaller download and install.** Epona was packaging every user-interface
  library twice — once compiled into the app, and again as unused source
  alongside it — and shipping about 12 MB more that nothing at runtime reads,
  including test-coverage reports and the animated screenshots from the README.
  Removing all of it cut the application payload from about 138 MB to 6 MB. The
  download itself shrinks by less, because most of it is the browser engine Epona
  is built on.

- **The portable build no longer starts in silence.** The portable `.exe`
  unpacks itself before Epona can draw anything, which took several seconds with
  no sign it had worked — easy to read as a failed launch and double-click
  again. It now shows the Epona splash almost immediately, while it unpacks.

- **"Reveal logs folder" moved out of Settings → About.** It is still on the
  Report an Issue dialog, which is where it is actually useful; the About card
  now offers What's New in its place.

### Fixed

- **The window is no longer slightly too narrow for its own content.** On a
  display with Windows scaling above 100%, Epona sized its window ~29px
  narrower than the layout it had just asked for, so panels, fields and buttons
  ran off the right edge — and dragging the window wider "fixed" it. Sizing the
  window and sizing the content used two different coordinate systems, and the
  limits were applied before the content size instead of after.

- **Epona now fits screens it previously overhung.** The window height was fixed
  at 800px regardless of the display, which is taller than the usable desktop on
  a 1080p screen at 125% or 150% scaling — so the bottom of the window sat off
  the edge. Epona now asks for no more than the screen can show, and the layout
  adapts to the window it actually gets instead of assuming it got what it asked
  for.

- **"No client detected" is readable on the Hybrasyl theme.** It was drawn in a
  muted slate that sat almost invisibly against that theme's teal toolbar. It
  now uses the theme's cyan, which is also the right signal — a client that has
  not been located yet is a notice, not an error.

- **Worktrees now work when the repo path is not its canonical form** — a repo
  reached through a junction, a mapped drive, or a short (8.3) directory name.
  Epona compared the path you gave against the path git reports, which are not
  the same string in those cases, so it could not adopt, list or remove the
  worktrees it had made.

### Security

- **Epona's interface now runs in the operating system's sandbox.** The part of
  the app that draws the window is confined the way a browser tab is, so a flaw
  in it cannot reach your files directly — it can only ask the trusted part of
  Epona, which checks every request.

- **Those requests are now checked for where they came from.** Everything the
  interface asks Epona to do — read your settings, launch a client, run a git
  command — is accepted only from Epona's own window showing Epona's own page.
  Anything else asking is refused.

- **A page on another machine can no longer pose as Epona's own.** That check
  compared only the file path, so a copy of Epona's page on a network share at a
  matching path was accepted as the real one — and got everything the real one
  gets. It now compares the machine as well. A default Windows install was never
  reachable this way; an install on a network drive was, as were macOS and Linux.

- **The shipped Epona binary can no longer be used to run arbitrary code.**
  Electron applications ship with developer escape hatches switched on, one of
  which lets anyone who can set an environment variable turn the signed
  `Epona.exe` into a general-purpose script interpreter. Those are now switched
  off.

- **Links now open only if they are web links.** Anything Epona hands to your
  browser is checked to be `http`, `https` or `mailto` first, and the main window
  can no longer be navigated away from the app.

- **Epona now runs on Electron 41.10.3**, up from 41.2.0 — eight patch releases
  of Chromium security fixes that the app was missing. No behavior changes.

- **Build-toolchain dependencies updated** to clear ten advisories, including a
  credential leak in `electron-builder`'s upload path, a path-traversal bug in
  `postcss`, and a denial-of-service bug in `brace-expansion`. These affect only
  how Epona is built, not the app you run.

## [2.6.0] - 2026-07-23

### Added

- **Ground Item Hints** (Legacy client, Dark Ages 7.41 only). Hold either Alt key
  to draw every visible ground item again as a translucent hint on top of the
  scene, so items behind a wall or a tree are easy to spot. Release Alt and the
  hints go away immediately. The option only appears when Epona has identified
  your client as 7.41 — it installs code into the running client, and the
  addresses it needs were only mapped for that build. Turning it on also fixes
  keys sticking down when the game loses focus.

- **Epona now tracks running servers properly.** The Server tab asks the launcher
  what is actually running instead of remembering what it started: it watches the
  server process and checks the instance's lobby port. A server you started in an
  earlier Epona session — or by hand — is picked up and shown as **running
  (external)**, and you can stop it from Epona.
- **Worktree housekeeping.** When you switch an instance (or the client) to a
  different branch, Epona offers to remove the old branch's git worktree. It also
  clears worktrees that no saved setting points at any more, at startup and at
  quit. Worktrees with uncommitted changes are always kept — only Flush Worktrees
  discards those, and it still asks first.
- **Settings → Maintenance lists your managed worktrees**, with the branch, the
  path, a "dirty" mark, and a Remove button for each.
- **An installer.** Windows releases now ship an NSIS setup .exe next to the
  portable build.

### Fixed

- **Picking a specific client version no longer stops your settings from
  saving.** Choosing a version instead of leaving it on Auto wrote a value the
  settings validator rejected, so that change — and every change after it — was
  silently dropped.
- **Only one Epona runs at a time.** A second launch focuses the window you
  already have. Two copies used to fight over the same settings and cache folder,
  and neither one could see the servers the other had started.
- **A server that stops on its own no longer shows as running.** Closing the
  server's console window now updates the button and releases the git worktree
  that launch was holding.
- **The taskbar shows the Epona icon and name** instead of a generic Electron
  one. The running window advertised a different app ID than the installer
  registered.
- **Builds no longer carry Epona's own development files** — the packaged app
  shipped the test suites, coverage reports, and internal notes inside itself.
- **The splash window can't get stuck.** It now appears even if the window-ready
  signal never arrives, and it closes itself if the app fails to start, instead of
  floating on top of everything with no way to close it.

## [2.5.0] - 2026-07-12

### Added

- **Mundanes light theme** — a flat, "corporate" light theme sitting alongside the
  four dark fantasy themes (Hybrasyl, Chadul, Danaan, Grinneal). On the plain
  themes the window chrome switches to flat standard controls instead of the
  stylized fantasy glyphs.
- **About section in Settings** — shows the app version and readable links to
  hybrasyl.com and the GitHub repo (legible on every theme, including the dark
  ones where they used to nearly vanish).
- **Flush Worktrees** maintenance action (Settings → Maintenance) — force-clears
  Epona-managed git worktrees for your configured repos. Use it when a repo-mode
  launch wedges with a "worktree already exists" error. It confirms first, since
  it discards uncommitted work inside those managed worktrees.

### Changed

- **Restyled title bar** — the logo and app title are now left-aligned, and the
  plain themes get flat window controls to match their look.
- **Settings reorganized into single-open collapsible sections** — one section is
  expanded at a time, so the pane stays compact instead of scrolling a long form.
- **Console / log output is now selectable** for copy-paste.

### Fixed

- **The Settings pane no longer nudges the UI when it opens.** Two separate
  breakpoint glitches are gone: the content/title indent (MUI toolbar gutters
  flipping as the window widened past 600px) and the Epona title changing font
  size on open. The window also no longer leaves a left-side gap when a side pane
  opens — the frameless resize was reworked to stop shifting the client area.
- **Repo-mode launches recover instead of wedging.** Flush Worktrees now actually
  flushes (it was silently doing nothing), and the launcher prunes stale worktree
  registrations and adopts/repairs a pre-existing worktree rather than failing
  with "already exists".
- **The distributed Hybrasyl client `.exe` now launches correctly.**
- About links are readable on every theme.

### Under the hood

- Added an end-to-end test harness (Playwright + Electron) that drives the built
  app, so window/layout regressions like the ones above are caught by measurement
  rather than by eye.
- A round of code-health refactors across the main and renderer processes
  (extracted the settings sections, shared the dotnet-runtime/branch logic, made
  the child-process log piping unit-testable) — see the full commit list below.
