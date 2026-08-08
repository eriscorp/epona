# Epona plans — overview & conventions

Read this before any work package (WP). It is the index: what Epona is, what has been settled, what shipped in each release, and what binds every plan doc written here.

**Doc layout.** Planned and in-progress WP docs sit at the top level of `docs/plans/`. Shipped ones move to `complete/` **on the branch that ships them**, not after the merge. This file and [`00a-backlog.md`](00a-backlog.md) stay put. Reference docs that are not plans — [`../antivirus.md`](../antivirus.md), [`../da-installer.md`](../da-installer.md), [`../release-process.md`](../release-process.md), [`../server-launch-resolution.md`](../server-launch-resolution.md) — stay in `docs/` and are not governed by this file.

## What Epona is

A desktop launcher for Dark Ages and Hybrasyl. It starts the legacy client (patching its memory on Windows), the Hybrasyl client, and local Hybrasyl server instances from a git checkout — and, since 2.7.2, unpacks the retail Dark Ages client files on any platform without running the Windows installer. Electron + React 19 + MUI 9 + Zustand on the house Electron skeleton.

**Repo-specific facts live in [`../../CLAUDE.md`](../../CLAUDE.md)** — the commands, the architecture, and the list of things that will bite you. This file does not restate them; it records what was _decided_, what _shipped_, and what a plan doc here must contain.

**House standards live in the document repo** and are authoritative where they conflict with anything here: `docs/architecture/dev-practices.md` (how we work), `docs/architecture/electron-app-skeleton.md` (how the app is built), and `docs/architecture/design-docs.md` (how we plan — the standard this directory implements).

**Primary reuse source:** `hyb-electron-template`, the house skeleton every sibling forks. The public `spark` launcher is inspiration only, and the `sparkAPI` bridge name is the fossil it left behind.

## Settled decisions (do not relitigate)

1. **Epona has no Tier-1 design doc, and this is a gap rather than a decision.** The document repo has `docs/plans/<app>/<app>-design.md` for the apps planned under the standard; Epona predates it and was built card by card. Nothing here should be read as the charter that document would be. Recorded so the absence is visible instead of assumed. (Caeldeth, 2026-08-08 — see [`00a-backlog.md`](00a-backlog.md).)

2. **Epona schedules in the tracker, not in WP numbers.** A card is the unit of work and the unit of scheduling; a `NN-slug.md` here is written only when a piece of work is too large to specify on a card. Numbering starts at `01` and is **not** applied retroactively — the three plan docs already in `complete/` keep their unnumbered names, because renaming them would break every commit message and comment that cites them for no gain. (Caeldeth, 2026-08-08.)

   _Why this differs from the siblings:_ dagda and mabon adopted the standard while planning a new app, so the WP set _was_ the plan and the numbers carried the dependency graph. Epona is four minor versions into shipping, and its dependency graph is the code. Minting fifty retroactive numbers would produce a second, worse index of a history the changelog and the tracker already hold.

3. **The register is a file, not a card and not a cleanup WP.** [`00a-backlog.md`](00a-backlog.md) is the single live statement of what Epona has consciously declined, and of the trigger that would reopen each item. A review that records both a decline and a recommendation for the same item has happened twice here and cost real work both times — see the register's opening note. (Caeldeth, 2026-08-08, closing HTOO-330.)

4. **Epona is JavaScript, not TypeScript.** There is no `typecheck` script and the full gate is `npm run lint:check && npm test && npm run build`. This is a recorded divergence from the skeleton standard, not an oversight, and a plan that assumes a `typecheck` step is wrong about this repo.

5. **The renderer global is `window.sparkAPI`, not the house `window.api`.** Renderer code reaches it through `src/renderer/src/diagnosticsBridge.js` where possible, so the name is in one place. Renaming it is a breaking change to the preload contract with no user-visible payoff; it stays.

6. **The six themes are hand-written objects, not a factory.** `src/renderer/src/themes/` holds six theme files, `danaan` especially intricate. Collapsing them into a `createFantasyTheme(tokens)` generator has been proposed by three separate review passes and declined every time. It is the register's headline entry.

7. **Release notes are authored in `CHANGELOG.md` as PRs land**, user-facing prose only. Cutting a release promotes `## [Unreleased]`, and the tag fires `release.yml`, which extracts that section into the GitHub release body. Full steps in [`../release-process.md`](../release-process.md).

## Milestones

Milestones live here. **They are not work packages and never take a WP number.** Each release records what it contained and — where the build learned something the plan could not have known — what that was.

### 2.5.0 — 2026-07-12

Branch-aware repo launches and the worktree machinery. The plan is `complete/stage-3.1-branch-aware-repo-plan.md`; the embedded server console and the multi-target expansion that preceded it are `complete/embedded-server-console-plan.md` and `complete/multi-target-expansion-plan.md`. All three predate this index and are unnumbered by decision 2.

The first efficiency review (`complete/efficiency-review-2026-07-02.md`) ran against this line and its whole first wave was implemented.

### 2.6.0 — 2026-07-23

The second efficiency review (`complete/efficiency-review-2026-07-12.md`) was authored here and its findings applied. **Its lasting lesson is not an efficiency finding.** It recommended the theme factory in a "Suggested first wave" list while its own prose declined the same idea two sections above, and a reader scanning top-down reached the recommendation last and acted on it — twice. That is why decision 3 exists and why declines are recorded with triggers rather than deleted or filed as work.

### 2.7.0 / 2.7.1 — 2026-08-01

2.7.1 tripped `Trojan:Win32/Wacatac.C!ml`. The cause and the fix are in [`../antivirus.md`](../antivirus.md), and the shape of the fix is now load-bearing config: signing happens **during** packaging rather than after it, because a post-build pass over `dist/*.exe` signs the wrapper and leaves the payload — including `da_win32.node`, whose import table reads like process injection — bare inside it.

### 2.7.2 — 2026-08-07

Instance-lifecycle test coverage (HTOO-99) and the `untrackPidInstance` merge it unblocked (`bd1e8d5`), which is the last conditional item the 2026-07-12 efficiency review left open.

### Unreleased

The Legacy tab off Windows (HTOO-296), the cross-platform client unpacker, and the `EPONA_DISABLE_GPU` override. See `CHANGELOG.md` for the user-facing statement of each.

## Build order (current — 2026-08-08)

**Nothing is scheduled here.** Take work from the tracker; consult [`00a-backlog.md`](00a-backlog.md) before proposing a cleanup, because the thing you are about to propose may already have been declined with a reason.

## Binding conventions

Stated once here so a WP doc does not repeat them. **[`../../CLAUDE.md`](../../CLAUDE.md) is the fuller list** — read it, particularly the "Things that will bite you" section, before touching packaging, the native addon, or the icons.

- **IPC.** Register handlers on the `ipc` wrapper, **never the raw `ipcMain`**. `guardIpc` wraps it once in `whenReady` so the sender check applies by construction; a handler added on the raw import silently opts out. See `src/main/windowSecurity.js`.
- **Payload validation.** Everything crossing the IPC boundary is zod-validated in `src/main/schemas/`. `zod` is one of only two genuine runtime dependencies for this reason.
- **The preload may import `electron` and nothing else.** The main window runs `sandbox: true`, and a sandboxed preload's loader resolves only `electron` plus a few Node built-ins. A package import there builds and links fine, then throws in the packaged app and takes the whole bridge with it. Guarded by `e2e/preload-sandbox.spec.js`.
- **`src/shared/` imports neither electron nor node.** That is what makes it unit-testable and portable to the sibling apps.
- **Packaged files resolve from `__dirname`, not `app.getAppPath()`** — under the e2e harness the latter returns the entry file's directory.
- **`electron-builder.yml` `files` is an allowlist.** A new runtime asset must be named there or it silently does not ship.
- **Dependency placement.** Renderer libraries belong in `devDependencies`; vite bundles them, and anything in `dependencies` is _also_ copied into `app.asar` as unread source. Only `da-win32` and `zod` are runtime deps, and `da-win32` is invisible to dependency greps — it is `createRequire`-loaded, rollup-external and `asarUnpack`ed.
- **Verification gate.** `npm run lint:check && npm test && npm run build`, green, before the commit. Then drive the change in `npm run dev`; where the runtime cannot be driven here (a signed build, a live server target), say so and hand that check over rather than claiming it.

## What a WP doc here contains

`# WPn — Title` · **Size** (S/M/L, note if it grew and why) · **Depends on** (WP refs + "read `00-overview.md` first") · **Goal** (one paragraph) · **Decisions** (numbered, attributed, dated) · **Non-goals (stop-lines)**, with a pointer to whatever owns the deferred work · **Context refs** · **Current state when you start** · **New dependency** · **Contracts** (the exact IPC channels and schema additions, in real fenced JS/YAML) · **File map** (`file → purpose`, each _(new)_ or _(edit)_) · **Tests** · **Acceptance criteria** (numbered, user-observable in `npm run dev`, ending "All checks green").

**Respect the stop-line.** If you notice work belonging elsewhere, note it and stop. Park it in [`00a-backlog.md`](00a-backlog.md) with its trigger, or file a card if it is real work — but do not build ahead.

**When a WP ships**, its doc moves to `complete/` in the same PR as the code, gaining an `## As built` section above the original plan: what actually shipped, the calls taken that the plan left open or got wrong, and what was verified versus handed over. **Write it beside the original reasoning — never rewrite the plan to match the outcome.** Everything below `As built` is frozen prose from the day of the merge; a grep across `complete/` returns history, not status.
