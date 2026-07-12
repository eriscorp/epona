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

- Light "Mundanes" theme (a flat corporate look alongside the fantasy themes).
- About section in Settings.
- Flush Worktrees maintenance action (Settings → Maintenance) to clear
  Epona-managed git worktrees when a launch wedges on "worktree already exists".

### Changed

- Restyled title bar: left-aligned logo + title, with flat chrome on the plain
  themes.
- Console / log output is now selectable for copy-paste.

### Fixed

- The Settings pane no longer nudges the UI when it opens — both the title/content
  indent and the title font-size jump are gone.
- About links are readable on every theme.
- The distributed Hybrasyl client `.exe` now launches correctly.
- Flush Worktrees now actually flushes (it was silently doing nothing).
