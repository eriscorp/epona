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
