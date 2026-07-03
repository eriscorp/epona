# Epona Efficiency Review

_Repo-wide efficiency swarm over the main process, the target/IPC layer, and the
renderer (panels, themes, shared UI) — report-only, no changes made. The
`packages/da-win32` native addon, the `out/`, `dist/`, and `node_modules` trees,
and all test files were excluded. The swarm ran across several overlapping
dimensions; the near-identical reports each pass produced (branch-cache helpers,
`diagnoseAndExplain`, the branch selector, `runGit`, the snackbar/picker widgets)
have been merged into one canonical finding apiece. 27 findings after merge._

**By category:** duplication 21, efficiency 2, simplification 2, styling 1, dead-code 1.
**By severity:** high 5, medium 12, low 10.

---

## Cross-cutting (patterns spanning files/domains)

Ranked by value-to-effort.

### 1. Branch-cache helpers `refreshBranches()` + `withSavedBranchPinned()` duplicated between panels ⚠ high
- `renderer/components/ServerInstancePanel.jsx:191` / `HybrasylClientPanel.jsx:119` (`refreshBranches`), and `ServerInstancePanel.jsx:396` / `HybrasylClientPanel.jsx:68` (`withSavedBranchPinned`).
- Byte-identical, comments included. `refreshBranches` sets a loading entry then calls `window.sparkAPI.listGitBranches(p)` and writes ok/error entries in the same shape; `withSavedBranchPinned` pins the saved branch as `{ missing: true, loading }`. Both panels also keep an identical `branchCache` `useState`, and the ServerInstancePanel copy of `withSavedBranchPinned` is re-declared inside the render body every render.
- **Proposal:** Extract a `useGitBranches()` hook returning `{ branchCache, refreshBranches }` plus a standalone `withSavedBranchPinned()` into a shared renderer module (e.g. `renderer/src/useGitBranches.js`). Consume in both panels; this also lifts the SIP copy out of the render body.

### 2. `diagnoseAndExplain()` git-diagnosis helper duplicated near-verbatim across both repo-picker panels ⚠ high
- `renderer/components/ServerInstancePanel.jsx:295` / `HybrasylClientPanel.jsx:180`.
- Two ~40-line async functions mapping `window.sparkAPI.diagnoseGitRepo` results (`ok` / `no_git` / `not_repo` / `no_path` / git-error) to identical `{ accept, noGit, snack }` shapes. The only difference is one word in the `not_repo` message tail ("running directly from the picked folder." vs "…picked .csproj."). HybrasylClientPanel's own comment says it "mirrors the server panel's helper so the two pickers stay in lockstep."
- **Proposal:** Extract one `diagnoseAndExplain(path, { notRepoNoun })` into a shared module (e.g. `renderer/src/gitDiagnose.js`), pass the differing noun as a parameter, import in both panels, delete both copies. Removes the manual-sync burden the comment already flags.

### 3. Branch `<Select>` + refresh `IconButton` block repeated three times ⚠ high
- `renderer/components/ServerInstancePanel.jsx:489` (server branch), `ServerInstancePanel.jsx:597` (xml branch), `HybrasylClientPanel.jsx:329` (client branch).
- ~70 lines copied three times: the `FormControl`+notched `Select` with the `b.name` / `(current)` / `(remote)` / `(loading…)` / `(missing)` MenuItem suffix logic, the `noGit`-italic-or-`branchError` caption, and the loading-aware refresh `IconButton` in a `Tooltip`/span. They differ only in the field names (`serverBranch`/`xmlBranch`/`clientBranch`) and current-checkout sentinel handling.
- **Proposal:** Extract a `<BranchSelector>` component (props: `label, value, branches, disabled, loading, noGit, error, onChange, onOpen, onRefresh, allowCurrentCheckout, noGitText`) into `renderer/components/BranchSelector.jsx` and render it at all three sites. Collapses ~70 lines × 3 into one component plus three usages.

### 4. `PICKER_SX` and `CURRENT_CHECKOUT_VALUE` constants duplicated between panels
- `renderer/components/ServerInstancePanel.jsx:31` / `HybrasylClientPanel.jsx:25` (`PICKER_SX` monospace/ellipsis sx), and `ServerInstancePanel.jsx:40` / `HybrasylClientPanel.jsx:23` (`CURRENT_CHECKOUT_VALUE = '__current_checkout__'`).
- Both identical. `CURRENT_CHECKOUT_VALUE` is also a launcher sentinel, so a single canonical definition prevents drift.
- **Proposal:** Hoist both into a shared constants module (alongside the extracted branch helpers and PathPicker).

### 5. `PathPicker` sub-component defined separately in both panels
- `renderer/components/ServerInstancePanel.jsx:86` / `HybrasylClientPanel.jsx:34`.
- Both define a local `PathPicker` rendering a caption label row + `<Typography sx={{ ...PICKER_SX, opacity: value ? 1 : 0.5 }}>{value || placeholder}</Typography>` + Browse `Button`. They differ only in server's `extraAction` slot vs client's `placeholder`/`chip` props.
- **Proposal:** Promote a single `PathPicker` (superset of props: `label, value, onPick, disabled, placeholder, chip, extraAction`) to `renderer/components/PathPicker.jsx`, imported by both.

### 6. Near-identical `runGit()` duplicated across `gitOps.js` and `worktreeManager.js`
- `main/gitOps.js:22` / `main/worktreeManager.js:28`.
- Both spawn `git -C cwd …args` with stdio ignore/pipe/pipe + `windowsHide`, accumulate stdout/stderr via `.toString()` data handlers, reject on `error`, and on `exit` resolve/reject with the same `git <args> failed (exit N): <stderr>` message. The gitOps variant is the superset (adds `{ allowFail }`, returns `code`, trims trailing whitespace).
- **Proposal:** Keep the richer gitOps `runGit`, export it (or lift into a small `main/gitExec.js`), and have worktreeManager import it. Its porcelain parsing trims per line, so the trailing-whitespace strip is harmless. Removes ~25 lines.

### 7. Log-line formatter duplicated between main and renderer
- `main/index.js:324` (`formatLogLines`) / `renderer/src/App.jsx:234` (`saveLogToFile`'s inline `.map`).
- Identical `{ stream, text }` → `'[stderr]'` / `'[exit]'` / `text` `join('\n')` transform — one for main-side auto-save, one for the renderer's manual save-dialog path.
- **Proposal:** Move the pure formatter to a dependency-free shared module (e.g. `src/shared/logFormat.js`) and import from both processes (electron-vite bundles each separately, so a plain ESM util works). Delete both copies.

### 8. Identical `Snackbar` + `Alert` toast block repeated in three components
- `renderer/components/ActionButtons.jsx:72`, `HybrasylClientPanel.jsx:456`, `ServerInstancePanel.jsx:1012`.
- All three render `<Snackbar open={!!snack} onClose anchorOrigin={{bottom,center}}><Alert severity={snack?.severity} onClose sx={{ width:'100%' }}>{snack?.message}</Alert></Snackbar>`, differing only in the `autoHideDuration` expression (`snack?.duration ?? 4000` in the two panels).
- **Proposal:** Extract a `<SnackbarHost snack onClose />` component honoring an optional `snack.duration`; reuse in all three and anywhere a snack is added later.

### 9. Identical status-color sub-palette repeated in all five themes
- `renderer/themes/hybrasyl.js:31`, `chadul.js:31`, `danaan.js:31`, `grinneal.js:31`, `spark.js:31`.
- `error #ff0000`, `warning #FFFF00`, `success #38ff4f` are identical across all five; `info #6de7f7` is identical in four (spark differs at `#3080D0`).
- **Proposal:** Extract `STATUS_COLORS = { error:{main:'#ff0000'}, warning:{main:'#FFFF00'}, info:{main:'#6de7f7'}, success:{main:'#38ff4f'} }` into `themes/shared.js` and spread it into each palette (spark overrides `info`).

### 10. Fantasy typography block copied across four themes
- `renderer/themes/hybrasyl.js:37`, `chadul.js:37`, `grinneal.js:37`, `danaan.js:37`.
- Lines 37–51 of hybrasyl/chadul/grinneal are byte-identical (Crimson Pro body, Cinzel Decorative h1, Cinzel h2–h6/button/caption with exact `letterSpacing`/`fontWeight`); danaan is the same block with only a `color:'#2a1e08'` layered onto each heading. `shape:{ borderRadius:2 }` is likewise repeated on line 53 of all four.
- **Proposal:** Extract a shared `fantasyTypography` (and `shape`) into `themes/shared.js`. hybrasyl/chadul/grinneal use as-is; danaan spreads it and adds the heading color.

### 11. `iconSx` / toolbar-button `sx` duplicated between `TitleBar` and `NavToolbar`
- `renderer/components/TitleBar.jsx:4` / `NavToolbar.jsx:5`.
- `iconSx` (svg fontSize/stroke/strokeWidth) is byte-identical in both; `winBtnSx` (TitleBar:12-20) and `btnSx` (NavToolbar:13-22) differ only by NavToolbar's `mx: -0.5`.
- **Proposal:** Move `iconSx` and a base button sx into a small shared style module (e.g. `renderer/components/toolbarStyles.js`); NavToolbar spreads the base and adds `mx: -0.5`.

### 12. `.NET runtimeChip` status logic duplicated across both panels
- `renderer/components/ServerInstancePanel.jsx:426` / `HybrasylClientPanel.jsx:262`.
- Both build a `runtimeChip` IIFE from the same runtime state (`dotnetFound`/`netCoreApp10`/`sdk10`) producing the same `{ label, color }` strings ('.NET not installed', '.NET 10 runtime + SDK', '.NET 10 SDK missing', etc.); the only real difference is Hybrasyl's `needsSdk` flag (server always requires SDK in repo mode).
- **Proposal:** Extract `runtimeChip(runtime, { needsSdk })` into a shared helper (server passes `needsSdk: true`). Both panels also independently call `checkDotnetRuntime()` on mount — a shared `useDotnetRuntime()` hook could return both runtime and the derived chip.

### 13. Path-basename ("last segment") derivation reimplemented three times
- `main/settingsManager.js:201` (`deriveWorldDirName`), `renderer/components/SettingsPane.jsx:476` (`WorldDirDialog.browse`'s `derivedName`), `renderer/components/NavToolbar.jsx:35` (`assetsName`).
- Each strips trailing slashes, splits on `[\\/]`, and takes the last segment.
- **Proposal:** Add a dependency-free `basenameOfPath(p)` util and reuse in all three; the renderer callers can import from a shared module even though one caller is in main.

### 14. Duplicate socket connect/timeout/settled/destroy scaffolding in `portProbe` and `redisProbe`
- `main/portProbe.js:12` / `main/redisProbe.js:20`.
- Both wrap `createConnection` in a Promise with a `let settled`, a finalizer guarded on `settled`, `clearTimeout(timer)`, `try { socket.destroy() } catch {}`, and resolve — identical control scaffold differing only in the reply-parsing body (`serverTester.js` uses the same pattern via `cleanup()`).
- **Proposal (low value):** Optionally extract `withProbeSocket({ host, port, timeoutMs }, onConnect, onData)` owning the settled/timer/destroy lifecycle so each probe supplies only protocol logic. Parsing bodies diverge, so payoff is small; listed for completeness.

### 15. Panel-border literal `'1px solid rgba(255,255,255,0.15)'` hard-coded in several places
- `renderer/components/SettingsPane.jsx:135`, `LogPane.jsx:42`, `App.jsx:293` — plus `SettingsPane.jsx:147`, `LogPane.jsx:55` (borderBottom) and `App.jsx:301,320`.
- The exact literal / `borderColor:'rgba(255,255,255,0.15)'` appears 7 times rather than using `theme.palette.divider`.
- **Proposal:** Route these borders/dividers through the theme divider token (or a shared constant).

### 16. Exported `resolveConfigFile()` and `listOrphanWorktrees()` are unused in production
- `main/targets/serverTarget.js:14` / `main/worktreeManager.js:228`.
- `resolveConfigFile` is referenced only by `serverTarget.test.js` (its doc-comment "Useful for UI file-exists checks" is unimplemented); `listOrphanWorktrees` is referenced only by `worktreeManager.test.js` and its comment marks it "for the (future) Settings cleanup UI" — no IPC handler or caller exists.
- **Proposal:** Either wire these into the features they were written for, or delete them (and their tests) to remove unwired surface. Lower priority since both are test-covered and intentionally forward-looking.

---

## Localized (single-file)

Ranked by value-to-effort.

### L1. `instance:start` and `instance:reset` duplicate the spawn/track/strip tail verbatim ⚠ high
- `main/index.js:531` / `main/index.js:648` — lines 531-540 and 648-657 are byte-identical (`launchServer` call, `cleanup = result.cleanup ?? (async () => {})`, child/pid branch with `wireInstanceLogs`, safe-strip, return).
- **Proposal:** Extract `spawnAndTrackInstance(instance)` that runs `launchServer`, computes the cleanup default, sets the `instanceChildren` map entry, and returns the `{ child, cleanup, ...safe }`-stripped response. Call from both handlers; lives next to `wireInstanceLogs`.

### L2. `instance:start` and `instance:reset` duplicate the payload-validate + disk-resolve preamble ⚠ high
- `main/index.js:502` / `main/index.js:600` — lines 502-519 and 600-615 are identical (invalid-payload guard, `settingsManager.load()`, persisted `find(i => i.id === supplied.id)`, `resolveInstanceForLaunch` + world-dir error).
- **Proposal:** Extract `resolveSuppliedInstance(supplied)` returning either `{ error }` or the resolved `instance`; both handlers call it and early-return on error.

### L3. Kill-tracked-process logic duplicated across stop/reset/before-quit
- `main/index.js:555` (instance:stop), `:619` (instance:reset), `:730` (before-quit).
- The `once('exit')` → `kill()` → `Promise.race([…, setTimeout])` pattern and the PID `killProcessTree` + `instanceChildren.delete` + `safeSend('instance:childExit', …SIGKILL)` block recur at 564-571 / 621-628 / 734-736 and 579-590 / 631-639. instance:reset and instance:stop share almost the whole body; before-quit shares the shape (only timeout differs, 5000 vs 2000).
- **Proposal:** Extract `killTracked(instanceId, tracked, timeoutMs)` covering both the 'child' (exit-race) and 'pid' (taskkill + childExit) branches, with the timeout as a param.

### L4. IPC response-stripping `{ child, cleanup, ...safe }` repeated in three handlers
- `main/index.js:413` (client:launch), `:539` (instance:start), `:656` (instance:reset).
- The exact `const { child: _child, cleanup: _cleanup, ...safe } = result` destructure appears at all three sites.
- **Proposal:** Add a one-line `toSafeResult(result)` helper that returns `result` minus the non-serialisable `child`/`cleanup` fields; use it at all three sites.

### L5. `launchRepo` builds the same three-step cleanup closure three times and unwinds it manually on error
- `main/targets/serverTarget.js:309` (non-Windows success), `:332` (Windows success), `:342` (catch); plus the spawn-failure unwind at 324-327.
- The `removeBuildProps` → `releaseXml` → `releaseServer` sequence is written out identically in both success returns and both failure paths.
- **Proposal:** Define one `const cleanup = async () => { if (didWriteBuildProps) await removeBuildProps(serverWorktreePath); await releaseXml(); await releaseServer() }` after the vars are known, return it from both success paths, and reuse it (guarded) in the failure unwinds.

### L6. `listBranches` re-runs an extra git subprocess and recomputes `ensureDir`
- `main/gitOps.js:118`.
- `listBranches` calls `isGitRepo(repoPath)` (119) which internally runs a full `git rev-parse --is-inside-work-tree` subprocess **and** an `ensureDir` (`fs.stat`), then line 123 calls `ensureDir(repoPath)` a second time before running `git branch -a` — two git spawns and two stat calls where one of each would do.
- **Proposal:** Compute `const dir = await ensureDir(repoPath)` once and reuse it; let the single `git branch -a` cover the repo check (it already fails on a non-repo). At minimum dedupe the double `ensureDir`.

### L7. Backup-recovery path computes `withDefaults(data)` twice
- `main/settingsManager.js:346`.
- In `load()`'s backup branch, `await save(withDefaults(data))` (346) then `return withDefaults(data)` (347) run the full migration/coercion pipeline twice on the same object.
- **Proposal:** `const recovered = withDefaults(data); await save(recovered); return recovered`. Behavior-preserving; `withDefaults` is a pure transform.

### L8. Repeated adoption-find predicate and refcount bookkeeping in `ensureWorktree`
- `main/worktreeManager.js:119`, `:137`, `:153`, `:121`.
- The predicate `onDisk.find((e) => e.branch === branch || resolvePath(e.path) === target)` appears 3× (119/137/153), and the `branchMap.set(branch, { path, refcount: 1 }); refcounts.set(repo, branchMap); return path` block appears ~4× (121-123 / 139-141 / 154-156 / 180-182).
- **Proposal:** Extract a local `findAdopted(onDisk)` closure over branch/target and a `track(path, refcount)` helper doing the two `Map.set` calls; collapses the three adoption branches and the fresh-add tail to one-liners.

### L9. "Tracked child alive?" expression recomputed inline in several places
- `main/index.js:522` (instance:start already-running check), `:664` (instance:listRunning), `:687` (collectRepoRunning).
- The `tracked.kind === 'child' ? tracked.value.exitCode === null : true` liveness test is duplicated at all three.
- **Proposal:** Add a tiny `isTrackedAlive(tracked)` predicate and use it at all three sites.

### L10. Repeated "clone Set, delete id" running-instance update in `App.jsx`
- `renderer/src/App.jsx:168` (instance-exit listener), `:403` (onStop), `:416` (onReset).
- `setRunningInstances((prev) => { const next = new Set(prev); next.delete(instanceId); return next })` appears verbatim at all three.
- **Proposal:** Add a local `removeRunning(id)` helper and call it from all three sites.

### L11. `App` re-derives `window.sparkAPI.platform` instead of reusing `isWindows`
- `renderer/src/App.jsx:101` (`isWindows` computed), `:109` (recomputes `platform === 'win32'` for `startupTabIndex`), `:324` (`platform !== 'win32'` for the Alert guard).
- **Proposal:** Reuse the local `isWindows` at 109 and use `!isWindows` at 324. Purely a readability/consistency tidy.

---

## Suggested first wave

Highest value-per-effort, mostly mechanical and behavior-preserving:

1. **L1 + L2 — `instance:start`/`instance:reset` dedup** (`index.js:531/648` and `:502/600`) — the two `high`-severity localized wins; both blocks are byte-identical and collapse to `spawnAndTrackInstance` + `resolveSuppliedInstance`.
2. **#1 — `useGitBranches()` hook** (branch-cache helpers, `high`) — byte-identical across both panels and also lifts a helper out of a render body.
3. **#2 — Shared `diagnoseAndExplain`** (`high`) — ~40 near-identical lines whose comment already begs for de-duplication; one parameter differs.
4. **#4 — Hoist `PICKER_SX` + `CURRENT_CHECKOUT_VALUE`** — trivial shared-constants move that also protects the launcher sentinel from drift.
5. **#6 — Canonical `runGit`** (`gitOps.js:22` / `worktreeManager.js:28`) — clean cross-module extract; keep the superset, delete ~25 lines.
6. **#7 — Shared log formatter** (`index.js:324` / `App.jsx:234`) — a dependency-free `src/shared/logFormat.js` used by both processes.
7. **#9 + #10 — `themes/shared.js`** (status colors + fantasy typography) — safe object spreads across 4–5 themes; danaan/spark layer their overrides.
8. **#3 — `<BranchSelector>` component** — highest payoff of the JSX extractions (~70 lines × 3), moderate effort.
