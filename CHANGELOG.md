# Changelog

All notable user-facing changes to Epona are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[Semantic Versioning](https://semver.org/).

<!--
Release process (the notes are authored HERE, not edited on GitHub after the fact):
  1. As you land a PR, add its user-facing change under ## [Unreleased]
     (Added / Changed / Fixed / Removed / Deprecated / Security).
  2. To cut a release: rename ## [Unreleased] to ## [X.Y.Z] - YYYY-MM-DD, add a
     fresh empty ## [Unreleased] above it, and bump package.json to X.Y.Z.
  3. Tag vX.Y.Z and push. The release workflow runs scripts/changelog-extract.mjs
     to pull THIS version's section into the GitHub release body, then appends the
     auto-generated PR list below it.
Keep entries user-facing — internal refactors/tests show up in the appended auto list.
-->

## [Unreleased]

### Added

- **A "What's New" button in Settings → About.** It shows the release notes for
  the version you are running, with the full history below it — no need to go to
  GitHub to find out what changed. The notes ship inside the app, so it works
  offline.

### Changed

- **"Reveal logs folder" moved out of Settings → About.** It is still on the
  Report an Issue dialog, which is where it is actually useful; the About card
  now offers What's New in its place.
- **Epona installs smaller.** The packaged app was still carrying about 12 MB of
  files nothing at runtime reads — test-coverage reports and the animated
  screenshots from the README among them.

### Security

- **Links now open only if they are web links.** Anything Epona hands to your
  browser is checked to be `http`, `https` or `mailto` first, and the main window
  can no longer be navigated away from the app.

- **Epona's interface now runs in the operating system's sandbox.** The part of
  the app that draws the window is confined the way a browser tab is, so a flaw
  in it cannot reach your files directly — it can only ask the trusted part of
  Epona, which checks every request.

- **The shipped Epona binary can no longer be used to run arbitrary code.**
  Electron applications ship with developer escape hatches switched on, one of
  which lets anyone who can set an environment variable turn the signed
  `Epona.exe` into a general-purpose script interpreter. Those are now switched
  off.

## [2.7.0] - 2026-07-29

### Security

- **Epona now runs on Electron 41.10.3**, up from 41.2.0 — eight patch releases
  of Chromium security fixes that the app was missing. No behavior changes.
- **Build-toolchain dependencies updated** to clear nine advisories, including a
  credential leak in `electron-builder`'s upload path and a path-traversal bug
  in `postcss`. These affect only how Epona is built, not the app you run.

### Changed

- **Epona starts faster, and the splash screen actually shows its logo.** Every
  place the Epona logo appeared — the splash, the title bar, the Settings
  header, the window icon — loaded the same 1024×1024, 1.7 MB image, to draw it
  as small as 20 pixels across. On a cold start that decode landed on the
  splash's first paint, which is the one thing the splash exists to make fast.
  Each spot now loads an image sized for what it actually draws.

- **Smaller download and install.** Epona was packaging every user-interface
  library twice — once compiled into the app, and again as unused source
  alongside it. Removing the duplicates cut the application payload from about
  138 MB to 6 MB. The download itself shrinks by less, because most of it is the
  browser engine Epona is built on.

- **The portable build no longer starts in silence.** The portable `.exe`
  unpacks itself before Epona can draw anything, which took several seconds with
  no sign it had worked — easy to read as a failed launch and double-click
  again. It now shows the Epona splash almost immediately, while it unpacks.

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
