# Release Process

How to cut an Epona release end-to-end. Pushing a `v*` tag is the single
action that fires the [`release.yml`](../.github/workflows/release.yml)
GitHub Action, which builds **all three platforms** — signed Windows
portable exe, signed + notarized macOS dmg, and Linux deb + AppImage —
creates the GitHub Release with auto-generated notes, attaches every
artifact, and posts to Discord.

The flow at a glance:

1. Pre-release sanity (local)
2. Bump the version, commit, push to `main`
3. Push a `v*` tag — **this fires the build and publishes the release**
4. (Optional) Polish the auto-generated release notes in the GitHub UI
5. Watch the Actions run go green, then verify artifacts + Discord

---

## 1. Pre-release sanity (local)

Before bumping anything, run the full gate against `main`:

```bash
git checkout main
git pull
npm run lint:check
npm test
npm run build
```

All three must be clean. Epona is plain JS — no `typecheck` step. Use
`lint:check`, not `lint`: the latter is `eslint --fix` and rewrites
the tree, which is not what a pre-release check should do. If lint
regresses, fix it before tagging rather than after.

Then smoke-test what landed since the last release. `npm run e2e`
builds and drives the real app under Playwright (Windows only) and
covers most of it: the IPC sender guard in both directions, the
preload sandbox, What's New, and the window geometry.

Two limits are worth knowing. A change to the trusted-location set or
the IPC guard can reject every IPC and the app still opens a window —
the reveal backstop fires at 15 s — so "it launched" proves nothing;
`e2e/ipc-guard.spec.js` asserts the allow direction, which does. And
e2e runs against `out/`, so the Electron fuses and the packaged
renderer path are only provable on a real artifact — launch one of
the release's own binaries once the build lands (§5).

## 2. Bump the version

[`package.json`](../package.json)'s `version` field drives the release
tag and the artifact names. Pick the bump:

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
even if they never read the GitHub release notes.

## 3. Tag the release — this fires the build

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

Pushing the tag **triggers `release.yml`** (`on: push: tags: ['v*']`).
There is no separate "publish in the UI" step — the workflow creates
the GitHub Release itself once the platform builds finish. The `v`
prefix is required (the trigger matches `v*`) and is what shows in the
Discord post and on the release page.

## 4. (Optional) Polish the release notes

The `release` job uses `generate_release_notes: true`, so GitHub
auto-writes notes from the merged PRs / commits since the previous tag.
That's usually enough. If you want a hand-curated summary, edit the
release in the GitHub UI after it's published and group by user impact:

```bash
git log $(git describe --tags --abbrev=0 HEAD^)..HEAD --oneline
```

(`HEAD^` skips the version-bump commit so `describe` finds the prior
tag, not the one you just pushed.) Group by user impact, not commit
order — **Highlights** (new features), **Fixes**, **Security &
hardening**, **Developer / docs**.

## 5. What the workflow does

Pushing the tag fires [`release.yml`](../.github/workflows/release.yml),
which runs four jobs:

- **`build-windows`** (pinned `windows-2022`, Node 24): `npm ci` →
  `npm run rebuild` (rebuilds the `da-win32` native addon against the
  Electron ABI) → `npm run build` → installs Java 17 and downloads
  SSL.com CodeSignTool → `electron-builder --win --publish never`,
  which **code-signs every Windows binary as it packages** them →
  verifies the signatures → uploads `dist/*-setup.exe` and
  `dist/*-portable.exe`.

  Signing is not a separate step on the finished artifacts any more.
  `scripts/sign.js` is wired in as `win.signtoolOptions.sign` and runs
  once per signable binary; `scripts/after-pack-sign.js` handles
  `da_win32.node`, which electron-builder's signable-file walk skips
  because it is `asarUnpack`'d. Signing only the two outer artifacts
  left the whole extracted payload unsigned and contributed to the
  Defender false positive documented in
  [`antivirus.md`](antivirus.md). The **Verify signatures** step fails
  the build if any binary comes out unsigned, so a half-signed release
  cannot ship. Both scripts self-skip when the `ES_*` secrets are
  absent, so forks still build.
- **`build-linux`** (ubuntu-latest): builds and packages `deb` +
  `AppImage` (the `beforeBuild` hook is overridden with
  `scripts/noop-before-build.cjs` to skip the Windows-only addon
  rebuild).
- **`build-mac`** (macos-latest): imports the Developer ID cert into a
  temp keychain, **signs + notarizes + staples** the `.app` via
  electron-builder, then separately signs/notarizes/staples the `.dmg`.
- **`release`** (needs all three, only on a tag ref): downloads the
  artifacts and creates the GitHub Release via
  `softprops/action-gh-release@v2` with `generate_release_notes: true`,
  attaching the portable exe, deb, AppImage, and dmg — then posts a
  Discord announcement.

Watch the Actions tab to confirm all four jobs go green. Typical
runtime is several minutes (native rebuild, electron-builder packaging,
and macOS notarization are the slow steps).

## 6. After the build

- Confirm all artifacts are attached to the release page:
  `epona-X.Y.Z-setup.exe`, `epona-X.Y.Z-portable.exe`, `*.deb`,
  `*.AppImage`, `epona-X.Y.Z.dmg`, and `SHA256SUMS.txt`.
- Confirm the Discord post landed.
- Smoke-test the artifact: download the portable exe, run on a clean
  profile to make sure the native addon loaded and the app launches.
- Check the signature survived the round trip:
  `Get-AuthenticodeSignature .\epona-X.Y.Z-portable.exe` → `Valid`,
  signer `ERISCO LLC`.
- **Submit both Windows artifacts to Microsoft** at
  <https://www.microsoft.com/en-us/wdsi/filesubmission> as a *software
  developer*, before announcing widely. Each release is a new file with
  no reputation, and Defender's ML classifier flags Epona readily —
  submitting ahead of the first user report is much cheaper than
  handling it afterwards. Always do this when the signing certificate
  or the NSIS stub changes. Background in [`antivirus.md`](antivirus.md).
- If anything's wrong, delete the release, delete the tag
  (`git push --delete origin vX.Y.Z`), fix forward, re-tag, re-push.
  Tags are cheap; don't be precious about them.

---

## Pinned facts

- Workflow: [`.github/workflows/release.yml`](../.github/workflows/release.yml)
- Trigger: **`push` of a `v*` tag** (`on: push: tags: ['v*']`), plus
  manual `workflow_dispatch`. Pushing the tag builds and publishes;
  there is no `release.published` UI step.
- Builds on: `windows-2022` (pinned), `ubuntu-latest`, `macos-latest` —
  all Node 24.
- Produces: **Windows portable exe (signed), macOS dmg (signed +
  notarized), Linux deb + AppImage** — all attached to the GitHub
  Release automatically. Targets are configured in
  [`electron-builder.yml`](../electron-builder.yml).
- Local equivalents: `npm run build:portable` / `build:win` (Windows),
  `npm run build:mac` (→ `dist/Epona-x.y.z-*.dmg`), `npm run build:linux`
  (→ `dist/epona-x.y.z-x86_64.AppImage`, needs a Linux host or WSL2 with
  `mksquashfs`). The mac/linux scripts override the `beforeBuild` hook
  via `--config.beforeBuild=scripts/noop-before-build.cjs` to skip the
  Windows-only `da-win32` rebuild. Only needed if you want to build
  locally — CI produces all three.
- Native addon: `packages/da-win32/` is rebuilt against the Electron
  ABI in CI via `npm run rebuild`. Local Windows builds do this through
  the `beforeBuild` hook in `electron-builder.yml`.
- Signing secrets — Windows (SSL.com eSigner): `ES_USERNAME`,
  `ES_PASSWORD`, `ES_CREDENTIAL_ID`, `ES_TOTP_SECRET`. macOS
  (Developer ID + notarization): `MACOS_CERT_P12_BASE64`,
  `MACOS_CERT_PASSWORD`, `APPLE_API_KEY_P8_BASE64`, `APPLE_API_KEY_ID`,
  `APPLE_API_ISSUER`. Discord webhook: `DISCORD_WEBHOOK_URL`.
- Repo: <https://github.com/eriscorp/epona>. Previous tags:
  `git tag --sort=-version:refname`.
