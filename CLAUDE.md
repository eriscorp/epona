# CLAUDE.md — Epona

Epona is a desktop launcher for Dark Ages and Hybrasyl: it starts the legacy client (patching its
memory on Windows), the Hybrasyl client, and local Hybrasyl server instances from a git checkout.
Electron + React 19 + MUI 9 + Zustand, on the house Electron skeleton.

House working rules — branching, commit style, the verify-before-commit gate, PR prep, the security
posture, markdown style — live in the document repo's `docs/architecture/dev-practices.md`, and the
architecture standard in `electron-app-skeleton.md` beside it. **Prefer those if anything here
conflicts; this file is repo-specific facts only.**

## Commands

| Command                  | What it does                                                      |
| ------------------------ | ----------------------------------------------------------------- |
| `npm run dev`            | Run the app with hot reload.                                      |
| `npm run lint:check`     | ESLint with `--max-warnings 0`. Any warning fails.                |
| `npm test`               | Vitest, node environment.                                         |
| `npm run test:coverage`  | Same with v8 coverage over `src/**`.                              |
| `npm run e2e`            | Build, then Playwright against the built app. Windows only.       |
| `npm run build`          | electron-vite build into `out/`.                                  |
| `npm run build:portable` | Build + package the portable Windows exe.                         |
| `npm run rebuild`        | Rebuild the `da-win32` native addon against the current Electron. |

There is **no `typecheck` script** — Epona is JavaScript, not TypeScript. That is a recorded
divergence from the skeleton, not an oversight. The full gate is
`npm run lint:check && npm test && npm run build`.

## Architecture

- `src/main/` — the only code that touches the filesystem, spawns processes, or loads the native
  addon. `targets/` holds one launcher per target kind (legacy, Hybrasyl client, server);
  `patches/` is the Windows client memory-patcher; `schemas/` is the zod validation at the IPC
  boundary.
- `src/preload/` — the context bridge. The renderer global is **`window.sparkAPI`**, not the house
  standard `window.api`; renderer code reaches it through `src/renderer/src/diagnosticsBridge.js`
  where possible so the name is in one place.
- `src/renderer/` — React. Zustand stores in `store/`, themes in `themes/`.
- `src/shared/` — pure logic imported by main, preload and renderer alike. **No electron or node
  imports in this directory** — that is what makes it unit-testable and portable to siblings.
- `packages/da-win32/` — the Windows-only native addon (N-API). Loaded via `createRequire` and
  marked rollup-external, so a plain grep for `require('da-win32')` will not find it.

## Things that will bite you

- **`da-win32` is invisible to dependency greps.** It is `createRequire`-loaded, rollup-external and
  `asarUnpack`ed. It must stay in `dependencies`; demoting it breaks the Legacy tab at boot, and no
  static analysis will warn you.
- **`electron-builder.yml` `files` is an allowlist.** Adding a new runtime asset means naming it
  there, or it silently will not ship. `CHANGELOG.md` is on that list because What's New reads it.
- **Resolve packaged files from `__dirname`, not `app.getAppPath()`.** Under the e2e harness the
  latter returns the entry file's directory. `join(__dirname, '../../<file>')` is correct in a
  packaged build, under `dev`, and under e2e alike.
- **`resources/` has no vite `publicDir`.** Re-adding one double-ships every file in that tree; the
  comment in `electron.vite.config.mjs` explains why.
- **CI pins `windows-2022`, not `windows-latest`.** node-gyp 11.5.0 cannot parse VS 18, which
  windows-latest now carries, and the `da-win32` rebuild dies on it.
- **Renderer libraries belong in `devDependencies`.** Vite bundles them; anything in `dependencies`
  is also copied into `app.asar` as unread source. Only `@electron-toolkit/preload`, `da-win32` and
  `zod` are genuine runtime deps.
- **The themes are not a factory.** Six hand-written theme objects in `src/renderer/src/themes/`,
  `danaan` especially. Do not try to collapse them into a generator.

## Releases

Notes are authored in `CHANGELOG.md` under `## [Unreleased]` as PRs land — user-facing prose, not
internal refactors. Cutting a release promotes that heading to `## [X.Y.Z] - YYYY-MM-DD`, adds a
fresh empty `[Unreleased]`, and bumps `package.json`. Tagging `vX.Y.Z` fires `release.yml`, which
runs `scripts/changelog-extract.mjs` to pull the section into the GitHub release body. Full steps in
[docs/release-process.md](docs/release-process.md).
