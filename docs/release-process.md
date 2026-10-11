# Release Process

How to cut an Epona release end-to-end. Pushing a `v*` tag is the single
action that fires the [`release.yml`](../.github/workflows/release.yml)
GitHub Action, which builds **all three platforms** — signed Windows
installer + portable exe, signed + notarized macOS dmg, and Linux deb +
AppImage — creates the GitHub Release with auto-generated notes, attaches
every artifact, and posts to Discord.

The flow at a glance:

1. Pre-release sanity (local)
2. Bump the version, commit, push to `main`
3. Push a `v*` tag — **this fires the build and publishes the release**
4. (Optional) Polish the auto-generated release notes in the GitHub UI
5. Watch the Actions run go green, then verify artifacts + Discord
6. Start the packaged app, then publish the version manifest (`npm run publish:version`)

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

Two limits are worth knowing. A change to the trusted-location set or the IPC guard can reject every IPC and the app still opens a window — the reveal backstop fires at 15 s — so "it launched" proves nothing; `e2e/ipc-guard.spec.js` asserts the allow direction, which does. And e2e runs against `out/`, so the Electron fuses and the packaged renderer path are only provable on a real artifact. Each release build job reads the fuse wire off its own package (§5). The packaged renderer path needs a launch, which the next step covers.

Then package Epona and start the packaged app, before you tag. A tag publishes the release with no further step, so this is the last check before the release is published:

```bash
npm run build:portable
npm run verify:fuses -- dist/win-unpacked/Epona.exe
```

Start `dist/win-unpacked/Epona.exe` and `dist/*-portable.exe`. Each must open its window. Epona enforces the embedded asar integrity fuse (HTOO-381): if `app.asar` changed after the build, the packaged app exits with code 1 and prints `ASAR Integrity Violation` on stderr only. The user sees no window and no message. `npm test` and `npm run e2e` cannot find this fault, because they do not start a package. A local build is unsigned; that is correct, and it does not change the check.

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

  `scripts/sign.js` runs the CodeSignTool jar on `$JAVA_HOME/bin/java.exe` (the Java 17 that the workflow installs), then on the `java` on PATH. It never runs `CodeSignTool.bat` or the JDK 11.0.2 in the CodeSignTool zip. That JDK cannot build the certificate chain that `login.ssl.com` sent from 2026-09-30, so each sign on it failed with `PKIX path building failed` (HTOO-517).

- **`build-linux`** (ubuntu-latest): builds and packages `deb` +
  `AppImage` (the `beforeBuild` hook is overridden with
  `scripts/noop-before-build.cjs` to skip the Windows-only addon
  rebuild).
- **`build-mac`** (macos-latest): imports the Developer ID cert into a
  temp keychain, **signs + notarizes + staples** the `.app` via
  electron-builder, then separately signs/notarizes/staples the `.dmg`.
- **`release`** (needs all three, only on a tag ref): downloads the
  artifacts and creates the GitHub Release via
  `softprops/action-gh-release@v3` with `generate_release_notes: true`,
  attaching the portable exe, deb, AppImage, and dmg — then prints a
  reminder to publish the version manifest (§6) and posts a Discord
  announcement.

Each of the three build jobs runs `npm run verify:fuses` on its own package after packaging and before upload (HTOO-374). The reader finds the fuse wire in the binary and fails the job if a fuse is not as `electron-builder.yml` sets it. It reads `dist/win-unpacked/Epona.exe`, `dist/linux-unpacked/epona` and `dist/mac-universal/Epona.app`. The universal Mac app has one wire for each architecture, and the reader checks each wire. On macOS it runs before the dmg is signed. `scripts/release-artifacts.test.mjs` pins each step, its path and its position.

Watch the Actions tab to confirm all four jobs go green. Typical
runtime is several minutes (native rebuild, electron-builder packaging,
and macOS notarization are the slow steps).

## 6. After the build

- Confirm all artifacts are attached to the release page:
  `epona-X.Y.Z-setup.exe`, `epona-X.Y.Z-portable.exe`, `*.deb`,
  `*.AppImage`, `epona-X.Y.Z.dmg`, and `SHA256SUMS.txt`.
- Confirm the Discord post landed.
- Smoke-test the artifact: download the portable exe and the installer, and run each on a clean profile to make sure the native addon loaded and the app launches. A build that does not open its window can have a damaged package (§1): take the release down.
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
- **Publish the version manifest.** When the smoke test passes, run `npm run publish:version -- vX.Y.Z` in this checkout. The script writes this version to `versions.json` in a sibling `../cernunnos` checkout, then commits and pushes that one file with your own git access. It needs `gh` and a clean `../cernunnos` on `main`. It refuses a release that is not published as stable, a tag that does not match `package.json`, and a version that is not newer than the one in the file. Add `--dry-run` to see the change and write nothing. Running copies of Epona do not see the release until you do this step. The release job's summary reminds you. Design: the document repo, `docs/architecture/update-check-module.md`.
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
- Produces: **Windows installer + portable exe (both signed), macOS dmg
  (signed + notarized), Linux deb + AppImage** — all attached to the
  GitHub Release automatically. Targets are configured in
  [`electron-builder.yml`](../electron-builder.yml), and **only** there —
  the packaging step runs a bare `--win`. `scripts/release-artifacts.test.mjs`
  pins the declared targets against the release globs in both directions,
  because a target that no glob collects is published by nothing and
  reported by nothing (`fail_on_unmatched_files` cannot see it). Prefer
  the **installer** when advising a user on a managed Windows endpoint;
  see [`antivirus.md`](antivirus.md).
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
