# Release Process

How to cut an Epona release end-to-end. The portable Windows build is
produced by the [`release.yml`](../.github/workflows/release.yml)
GitHub Action; everything else is a few manual steps in the right
order.

The flow at a glance:

1. Pre-release sanity (local)
2. Bump the version, commit, push
3. Push a `v*` tag — **this does not trigger the build**
4. Draft the release in the GitHub UI from that tag, write notes
5. Publish the release — this fires `release.yml`, which builds the
   portable exe, attaches it, and pings Discord

---

## 1. Pre-release sanity (local)

Before bumping anything, run the standard checks against `main`:

```bash
git checkout main
git pull
npm run lint
npm run test
```

Both must be clean. Epona is plain JS — no `typecheck` step. Lint is
expected to exit 0 (was hardened in the run-up to this release; if it
regresses, fix before tagging rather than after).

Also smoke-test anything user-visible that landed since the last
release. The dev server is the user's job to launch
(`npm run dev` in their own shell), since Claude-launched Electron
hasn't worked reliably.

## 2. Bump the version

[`package.json`](../package.json)'s `version` field drives the release
tag and the artifact name. Pick the bump:

- **Patch** (e.g. `1.0.0 → 1.0.1`): bug fixes only, no new
  user-visible features.
- **Minor** (e.g. `1.0.x → 1.1.0`): new features, sizeable additions,
  or security hardening that users should notice. This is the common
  case.
- **Major** (e.g. `1.x → 2.0`): breaking changes to settings format
  (e.g. the `worldDirectories` schema migration), the IPC contract,
  or anything that requires the user to reconfigure.

Edit `package.json`, then:

```bash
git add package.json
git commit -m "chore: bump version to X.Y.Z"
git push origin main
```

The commit message body can summarize the major themes of the release
(features, fixes, hardening) — it's what a reader sees in `git log`
even if they never see the GitHub release notes.

## 3. Tag the release

Push the tag from CLI before opening the UI:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

This does **not** trigger the build — `release.yml` listens for the
`release.published` event, not tag pushes. The tag just exists so the
GH UI can build a release against it in step 5.

The `v` prefix is conventional for tag-name display in the Discord
post and the release page artifacts.

## 4. Draft the release notes

Get the full commit list since the previous release tag:

```bash
git log $(git describe --tags --abbrev=0 HEAD^)..HEAD --oneline
```

(`HEAD^` skips the version-bump commit so `describe` finds the prior
tag, not the one you just pushed.)

**Read the whole list, don't skim.** Easy to undercount when many
commits are docs/chore that you'll skip but a few are quietly
user-visible. Group by user impact, not by commit order:

- **Highlights**: new features users will notice. One bullet per
  feature, lead with the user-facing thing, not the implementation.
- **Fixes**: bugs closed since the last release.
- **Security & hardening**: anything that changes the trust boundary
  (IPC validation, spawn-path whitelisting, settings save resilience).
- **Developer / docs**: test infra, plan archives, doc additions.
  One short bullet per topic, not per commit.

Keep the markdown raw (in a fenced block when sharing in chat) so it
copies clean into the GH UI without rendering artifacts.

## 5. Create the release in the GitHub UI

1. Go to <https://github.com/hybrasyl/epona/releases> → **Draft a new
   release**.
2. **Choose a tag** → pick the `vX.Y.Z` you pushed in step 3.
3. **Release title** → `vX.Y.Z` (or a short headline).
4. Paste the markdown notes from step 4 into the description.
5. Leave **Set as the latest release** checked.
6. **Publish release**.

Publishing fires `release.yml` (via the `release.published` event):

- Installs deps (`npm ci`).
- Rebuilds the native addon (`npm run rebuild` → `da-win32`).
  Required because the addon is built against the Electron ABI.
- Builds renderer + main bundles (`npm run build`).
- Packages the portable exe (`electron-builder --win --publish never`).
- Attaches `dist/*-portable.exe` to the just-published release via
  `softprops/action-gh-release@v2` (notes you wrote in step 4 stay
  intact — the action only adds files).
- Posts a Discord announcement to the channel configured in the
  `DISCORD_WEBHOOK_URL` repo secret.

Watch the Actions tab to confirm the build went green. Typical
runtime is a few minutes (the native rebuild and electron-builder
packaging are the slow steps).

## 6. After the build

- Confirm the portable exe is attached to the release page.
- Confirm the Discord post landed.
- Smoke-test the artifact: download it, run on a clean profile to
  make sure the native addon loaded and the app actually launches.
- If anything's wrong with the artifact, you can delete the release,
  delete the tag (`git push --delete origin vX.Y.Z`), fix forward,
  re-tag, and re-publish. Tags are cheap; don't be precious about them.

---

## Pinned facts

- Workflow: [`.github/workflows/release.yml`](../.github/workflows/release.yml)
- Trigger: `release.published` event — i.e. clicking **Publish** on a
  draft release in the GitHub UI. Tag pushes by themselves do nothing.
- Builds on: `windows-latest`, Node 24
- Currently produces: Windows portable exe only. The portable target
  is configured in [`electron-builder.yml`](../electron-builder.yml)
  (`win.target: portable`), so plain `electron-builder --win` is all
  the workflow needs — no CLI flag required.
- Local equivalent: `npm run build:portable` (or `build:win` — they're
  identical right now). Both run `npm run build && electron-builder
  --win`, which is what CI does in two steps.
- macOS / Linux are local-manual builds (not CI-published). On a mac:
  `npm run build:mac` → `dist/Epona-x.y.z-{arm64,x64}.{dmg,zip}`. On a
  Linux host or inside WSL2 (where `mksquashfs` exists):
  `npm run build:linux` → `dist/epona-x.y.z-x86_64.AppImage`. Both
  scripts override the `beforeBuild` hook via
  `--config.beforeBuild=scripts/noop-before-build.cjs` so the
  Windows-only `da-win32` rebuild is skipped. After local builds,
  attach the artifacts to the release page by hand (release-edit →
  "Attach binaries").
- Native addon: `packages/da-win32/` is rebuilt against the Electron
  ABI in CI via `npm run rebuild`. Local builds also need this — the
  `beforeBuild` hook in `electron-builder.yml` invokes the same
  `@electron/rebuild` command, so a fresh `electron-builder` invocation
  picks it up.
- Discord webhook URL lives in repo secret `DISCORD_WEBHOOK_URL`.
- Previous tags: `git tag --sort=-version:refname`.
