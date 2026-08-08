# Stage 3.1 — Branch-aware repo mode

## Context

Stage 3.0 ships server instances that launch from a prebuilt `Hybrasyl.dll` or `.exe`. That covers QA-style "I have a known-good build, run it" but not the case the launcher actually exists for: developing a server feature that touches both the server repo *and* the Hybrasyl.Xml repo, where you want to spin up multiple branches against shared world data without csproj edits or worktree juggling.

Stage 3.1 makes that work. An instance picks **mode**:
- **binary** — current Stage 3.0 behavior (binary path → `dotnet <dll>` or `<exe>`)
- **repo** — server repo path + branch (optional: XML repo path + branch). Epona ensures a `git worktree` for each, optionally writes a `Directory.Build.props` in the server worktree to redirect the `Hybrasyl.Xml` reference, then `dotnet run --project <serverWorktree>/hybrasyl/Hybrasyl.csproj -- --datadir … --logdir … --config <name>`.

**Server-side prereqs are already done** on `feature/epona-branch-instances` ([commit 11bc748](https://github.com/hybrasyl/server/commit/11bc748)): conditional `UseLocalXml` ProjectReference in `hybrasyl/Hybrasyl.csproj`, `.gitignore` for `.worktrees/` and `Directory.Build.props`, design doc at [docs/epona-branch-instances.md](e:/Dark Ages Dev/Repos/server/docs/epona-branch-instances.md). When `UseLocalXml` is unset (the default), the existing `Hybrasyl.Xml` 0.9.4.11 NuGet package is used — zero-impact for everyone not using Epona's repo mode. **Sequence**: that branch must merge to the server's main before Epona's Stage 3.1 ships, same coordinated-dependency model as Stage 2's Chaos.Client cfg patch.

---

## Layout decision (UI capacity)

The Server tab is already cramped at `WINDOW_H = 720` after the Stage 3.0 Redis caption + ports. Stage 3.1 adds: mode toggle, server repo path picker, server branch dropdown, "use local XML" checkbox, XML repo path picker, XML branch dropdown — plus the embedded-console toggle from the 3.0a follow-up if/when it lands.

**Recommended:** mode-conditional rendering + modest height bump (`WINDOW_H` 720 → 800). Repo mode hides `binaryPath`; binary mode hides everything repo-related. Each mode stays roughly at current density. Mode itself is a small `ToggleButtonGroup` (Binary | Repo) at the top of the detail form, wedged into the Name row to save a row.

**Fallback if it's still cramped:** sub-tabs *inside* the Server panel — "Source" (mode + paths/branches OR binary path), "Runtime" (world data, log dir, server config), "Network" (Redis + ports). One extra click but keeps each section breathable. Only do this if mode-conditional + 800px doesn't fit; don't reach for it preemptively.

A new top-level tab is a worse fit — instances are still one logical concept; splitting them across tabs duplicates the instance selector.

---

## Recommended approach

### 1. Worktree manager (`src/main/worktreeManager.js`)

Refcounted lifecycle for `git worktree`-managed branches. One worktree per `(repoPath, branch)` pair, shared across instances.

```js
// Internal state: Map<repoAbsPath, Map<branchName, { path, refcount }>>
// All ops serialized via a per-repo mutex so concurrent ensure/release calls
// from two instances on the same repo don't race git's worktree lock.

export async function ensureWorktree(repoPath, branch)
  // Returns absolute path to <repoPath>/.worktrees/<sanitize(branch)>/
  // - If already present in-memory: bump refcount, return path
  // - If present on disk but not in-memory (Epona restart): adopt, refcount = 1
  // - Else: `git -C <repoPath> worktree add <path> <branch>`, refcount = 1

export async function releaseWorktree(repoPath, branch)
  // - Decrement refcount
  // - If 0: `git -C <repoPath> worktree remove <path>` (force only if --dirty
  //   was opted-in by the caller; default is non-force so we don't blow away
  //   a developer's in-progress edits inside the worktree)
  // - If `git worktree remove` fails with "is dirty" → log + leave on disk;
  //   surface in UI as "worktree retained (had local changes)"

export async function listOrphanWorktrees(repoPath)
  // Read `git worktree list --porcelain`, return entries under .worktrees/
  // not currently referenced by any instance. Used by the Settings drawer
  // (later) for cleanup; not auto-pruned because dirty worktrees are valuable.

export function sanitizeBranchName(branch)
  // 'feature/foo' → 'feature__foo'; strip anything outside [A-Za-z0-9._-/];
  // collapse repeated separators. Stable so the same branch always maps to
  // the same dir.
```

Refcount lives in-memory only. On launcher restart, an instance asking for a worktree that's already on disk adopts it — no PID adoption complexity needed because worktrees are file-system state, not process state.

### 2. Build-props writer (`src/main/buildProps.js`)

Manages the gitignored `Directory.Build.props` at the server worktree root. Pure file IO, no git.

```js
export async function writeBuildProps(serverWorktreePath, xmlCsprojAbsPath)
  // Idempotent: if file exists with matching content, skip the write (so the
  // file's mtime stays stable and we don't trigger a phantom MSBuild rebuild).
  // Always windows-style backslashes inside <LocalXmlProjectPath> for
  // MSBuild's sake — doesn't matter functionally but matches the design doc.

export async function removeBuildProps(serverWorktreePath)
  // Idempotent: if missing, no-op. Called when an instance with xmlBranch is
  // torn down AND no other instance on the same server worktree references
  // a different XML branch (refcount via worktreeManager covers the worktree
  // itself; we ref-track build-props writes separately because two instances
  // on the same server branch but different XML branches would clobber each
  // other — flag this as a v1 limitation, see Risks).

// Generated content:
// <Project>
//   <PropertyGroup>
//     <UseLocalXml>true</UseLocalXml>
//     <LocalXmlProjectPath>E:\…\xml\.worktrees\<branch>\src\Hybrasyl.Xml.csproj</LocalXmlProjectPath>
//   </PropertyGroup>
// </Project>
```

The XML csproj path is `<xmlWorktree>/src/Hybrasyl.Xml.csproj` (verified — XML repo has the csproj under `src/`).

### 3. Git ops wrapper (`src/main/gitOps.js`)

Thin wrapper for the launcher's read-only git needs. Exists so we can mock it from tests and to keep error messages consistent.

```js
export async function listBranches(repoPath)
  // `git -C <repoPath> branch -a --format=%(refname:short)`
  // Filter remote-tracking duplicates. Sort: current first, then local,
  // then remote. Return [{ name, current, remote }].

export async function isGitRepo(repoPath)
  // `git -C <repoPath> rev-parse --is-inside-work-tree` — for the path picker
  // to give immediate feedback ("not a git repo" inline) instead of failing
  // later at worktree-add time.
```

### 4. `serverTarget.js` rework

Drop the `mode === 'binary'` gate in `validateForLaunch`. Add `validateRepoLaunch(instance)`:
- `serverRepoPath` set and a git repo
- `serverBranch` non-empty (allow null/'' to mean "use current checkout" — see below)
- If `xmlBranch` set: `xmlRepoPath` set and a git repo
- All the existing world/log/config/port checks

New `buildRepoSpawn(instance, { serverWorktreePath })`:
```js
// Returns the same { command, args, env } shape buildBinarySpawn does, so
// the launch() orchestrator stays target-shape-agnostic.
return {
  command: 'dotnet',
  args: [
    'run',
    '--project', join(serverWorktreePath, 'hybrasyl', 'Hybrasyl.csproj'),
    '--configuration', 'Debug',
    '--no-launch-profile',
    '--',  // dotnet/server arg separator
    '--datadir', instance.worldDataDir,
    '--logdir', instance.logDir,
    '--config', stripXmlExt(instance.configFileName)
  ],
  env: { /* same HYB_REDIS_* conditional logic as buildBinarySpawn */ }
}
```

`launch(instance)` orchestration:
1. `validateForLaunch` (now mode-aware)
2. Resolve Redis target + probe (unchanged from 3.0)
3. Port pre-flight (unchanged)
4. **Mode dispatch:**
   - `binary` → existing PowerShell-wrapper path, unchanged
   - `repo` →
     - `ensureWorktree(serverRepoPath, serverBranch || HEAD)` → serverWorktreePath
     - if `xmlBranch`: `ensureWorktree(xmlRepoPath, xmlBranch)` → xmlWorktreePath, then `writeBuildProps(serverWorktreePath, xmlCsproj)`
     - spawn via the same PowerShell wrapper that binary mode uses (so crash output is preserved the same way), but with `command/args/cwd` from `buildRepoSpawn`
     - on the eventual childExit (tracked via the existing `instance:childExit` IPC), `releaseWorktree` for any worktrees this instance ensured

Special case — `serverBranch === null`: use the user's current checkout directly, no worktree, no `--worktree-path` indirection. Useful for "I'm developing on this branch, just run *that*". Don't write Directory.Build.props in this case unless the user separately set `xmlBranch` against the in-place checkout (and even then, warn that it'll dirty their working tree's gitignored files).

**First-run UX:** `dotnet run` from a cold worktree triggers `dotnet restore` + first build, which is slow (10-60s on a clean machine). The PowerShell-wrapper approach already shows the spinner inside the console window, but Epona's Start button just sits "Starting…" the whole time. Add a `'building'` state to the running flag so the UI can show "Building…" → "Running" once we see the server's first stdout line. Hook into the existing line buffer.

### 5. IPC + preload

[src/main/index.js](e:/Dark Ages Dev/Repos/epona/src/main/index.js):
```js
ipcMain.handle('git:listBranches', (_, repoPath) => listBranches(repoPath))
ipcMain.handle('git:isGitRepo', (_, repoPath) => isGitRepo(repoPath))
```

Hook `app.on('before-quit')` to release all in-memory refcounted worktrees so a normal Epona shutdown leaves the disk tidy. (Force-close via Task Manager won't run this — orphan-worktree handling on next launch covers that case.)

[src/preload/index.js](e:/Dark Ages Dev/Repos/epona/src/preload/index.js):
```js
listBranches: (repoPath) => ipcRenderer.invoke('git:listBranches', repoPath),
isGitRepo: (repoPath) => ipcRenderer.invoke('git:isGitRepo', repoPath)
```

### 6. UI changes ([src/renderer/src/components/ServerInstancePanel.jsx](e:/Dark Ages Dev/Repos/epona/src/renderer/src/components/ServerInstancePanel.jsx))

**Mode toggle row** (new, between instance selector and Name):
```jsx
<ToggleButtonGroup
  size="small"
  exclusive
  value={selected.mode}
  onChange={(_, m) => m && updateSelected({ mode: m })}
  disabled={isRunning}
>
  <ToggleButton value="binary">Binary</ToggleButton>
  <ToggleButton value="repo">Repo</ToggleButton>
</ToggleButtonGroup>
```

**Conditional sections:**
- `selected.mode === 'binary'` → render the existing Binary Path picker
- `selected.mode === 'repo'` → render:
  - Server Repo path picker (new) — calls `isGitRepo` on change to inline-validate
  - Server Branch dropdown (new) — populated from `listBranches(serverRepoPath)`; first option is "(current checkout)" mapped to `serverBranch: null`
  - "Use local XML branch" checkbox (new, default off — when off, server uses NuGet `Hybrasyl.Xml` 0.9.4.11)
  - When checkbox on:
    - XML Repo path picker
    - XML Branch dropdown — same shape as server branch

**Memurai help tip** (next to the Redis caption):
```jsx
<Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mt: 0.5 }}>
  <Typography variant="caption" color="text.secondary">
    Config XML says: {configDataStore.host}:{configDataStore.port}…
  </Typography>
  <Tooltip
    title={
      <Box>
        <Typography variant="caption" sx={{ display: 'block' }}>
          On Windows, WSL Redis can drop forwarded connections under load.
          Memurai is a native Windows Redis-compatible alternative.
        </Typography>
        <Typography
          variant="caption"
          sx={{ display: 'block', mt: 0.5, fontFamily: 'monospace' }}
        >
          winget install Memurai.MemuraiDeveloper
        </Typography>
      </Box>
    }
  >
    <HelpOutlineIcon fontSize="inherit" sx={{ opacity: 0.6 }} />
  </Tooltip>
</Box>
```

Same tip should appear in the Redis-unreachable error Snackbar message (append " · Tip: try Memurai instead of WSL Redis" or similar).

**Building/Running state:**
The Start button currently flips between "Start Server" / "Stop Server" based on `runningIds`. Add a third visual state when `instanceLogs[id]` is empty AND running — show "Building…" with the spinner. First non-empty log line flips to "Stop Server". This lives in `App.jsx` since that's where `instanceLogs` lives — pass a derived `building` boolean down.

[src/renderer/src/App.jsx](e:/Dark Ages Dev/Repos/epona/src/renderer/src/App.jsx): bump `WINDOW_H` from 720 → 800.

### 7. Settings ([src/main/settingsManager.js](e:/Dark Ages Dev/Repos/epona/src/main/settingsManager.js))

The instance schema already has the right fields (`mode`, `serverRepoPath`, `serverBranch`, `xmlRepoPath`, `xmlBranch`) — they were stubbed in Stage 3.0. Just verify `coerceInstance` fills them with defaults (`mode: 'binary'`, others `''` / `null`) when migrating older saved instances.

### 8. Tests

- **`worktreeManager.test.js`** (new):
  - `sanitizeBranchName('feature/foo')` → `'feature__foo'`; `'main'` unchanged; `'release/v1.2.3'` → `'release__v1.2.3'`; collapsed separators
  - `ensureWorktree` mocked over `child_process.exec`: first call adds, second call on same branch increments refcount (no second `git worktree add`)
  - `releaseWorktree` decrements; reaches 0 → calls `git worktree remove`; "is dirty" failure leaves dir, returns warning
  - Adoption: a branch already on-disk (mock `git worktree list --porcelain` to include it) is adopted with refcount 1 on first `ensure`
- **`buildProps.test.js`** (new):
  - `writeBuildProps` produces expected XML; idempotent rewrite is a no-op (mtime stable)
  - `removeBuildProps` deletes; missing file is a no-op
- **`serverTarget.test.js`** (extend):
  - `validateForLaunch` accepts repo mode with required fields; rejects with friendly errors for each missing field
  - `buildRepoSpawn` produces `dotnet run --project <…> -- --datadir … --logdir … --config <name>` with the same env conditionality as binary mode
- **`gitOps.test.js`** (new): mock `git branch -a` output; assert parsing handles current marker, remote prefixes, detached HEAD
- **`settingsManager.test.js`** (extend): coerceInstance fills `mode: 'binary'` and the rest as defaults when migrating

---

## Critical files to modify / create

**New:**
- [src/main/worktreeManager.js](e:/Dark Ages Dev/Repos/epona/src/main/worktreeManager.js)
- [src/main/worktreeManager.test.js](e:/Dark Ages Dev/Repos/epona/src/main/worktreeManager.test.js)
- [src/main/buildProps.js](e:/Dark Ages Dev/Repos/epona/src/main/buildProps.js)
- [src/main/buildProps.test.js](e:/Dark Ages Dev/Repos/epona/src/main/buildProps.test.js)
- [src/main/gitOps.js](e:/Dark Ages Dev/Repos/epona/src/main/gitOps.js)
- [src/main/gitOps.test.js](e:/Dark Ages Dev/Repos/epona/src/main/gitOps.test.js)

**Modified:**
- [src/main/targets/serverTarget.js](e:/Dark Ages Dev/Repos/epona/src/main/targets/serverTarget.js) — `validateForLaunch` mode-aware, `buildRepoSpawn`, `launch` mode dispatch + worktree lifecycle
- [src/main/targets/serverTarget.test.js](e:/Dark Ages Dev/Repos/epona/src/main/targets/serverTarget.test.js) — repo-mode validate + spawn cases
- [src/main/index.js](e:/Dark Ages Dev/Repos/epona/src/main/index.js) — `git:listBranches` / `git:isGitRepo` IPC, `before-quit` worktree release
- [src/preload/index.js](e:/Dark Ages Dev/Repos/epona/src/preload/index.js) — `listBranches`, `isGitRepo`
- [src/main/settingsManager.js](e:/Dark Ages Dev/Repos/epona/src/main/settingsManager.js) — verify `coerceInstance` defaults for repo-mode fields
- [src/renderer/src/components/ServerInstancePanel.jsx](e:/Dark Ages Dev/Repos/epona/src/renderer/src/components/ServerInstancePanel.jsx) — mode toggle, conditional sections, Memurai tip, Building state plumbing
- [src/renderer/src/App.jsx](e:/Dark Ages Dev/Repos/epona/src/renderer/src/App.jsx) — `WINDOW_H` 720 → 800, derive `building` state
- [docs/multi-target-expansion-plan.md](e:/Dark Ages Dev/Repos/epona/docs/multi-target-expansion-plan.md) — flip Stage 3.1 from "deferred" to "shipped" with link

---

## Reused utilities

- The PowerShell-wrapper spawn shim in `serverTarget.js` — reuse unchanged for repo mode; just feed it different `command/args/cwd`
- `instance:log` / `instance:childExit` IPC + `LogPane` — already in place from Stage 3.0; first server stdout line is the trigger for flipping "Building…" → "Running"
- `instanceChildren` map in `index.js` — extend the `{ kind, value }` discriminator with worktree-release callbacks attached to the existing exit handler (no new tracking concept)
- `pickFile` / `pickDirectory` IPC — for repo path pickers
- The existing inline-validation pattern around `availableConfigs` (load-on-change `useEffect`) — copy that shape for the branch dropdown population

---

## Out of scope / deferred

- **Branch creation from inside Epona.** Just lists existing local + remote-tracking branches. New branches are made in a real git client; Epona picks them up next time the dropdown loads.
- **`git fetch` before listing branches.** Stale view if the user just pushed from elsewhere — they refresh by reopening the dropdown after fetching manually. Auto-fetch is a polish item.
- **Multi-XML-branch on the same server branch.** If two instances share a server branch but want *different* XML branches, the second instance's `Directory.Build.props` write clobbers the first. v1: detect and reject with a friendly error. v2: keep two server worktrees in that case (worktree-per-(server, xml) pair), but the refcount model gets messier — defer.
- **Worktree GC UI.** No "show me orphan worktrees and let me delete them" panel yet. `listOrphanWorktrees` exists for it, but the UI lands later.
- **PR / detached-HEAD instances.** Branch-only for now. PR branches are usually fetched as `pull/N/head` and exist as remote refs already, so they show up in the dropdown.
- **Build cache/artifact management.** `dotnet`'s own obj/bin caches handle this fine; we don't need to manage MSBuild output.
- **Bundled Redis / local-Redis-discover-and-offer-to-start** (Stage 3.2 territory per the original Stage 3 outline).

---

## Risks

- **Worktree corruption on hard kill.** If `taskkill /F` fires mid-`dotnet build`, MSBuild can leave file locks. Next `git worktree remove` may fail with "is dirty" or with permission errors. Tolerate: keep the dir, let the user delete it manually or via the future GC UI. Don't `--force` by default — force-removing a worktree the user happens to be editing is a bad surprise.
- **`git worktree add` collisions.** If the user already created a worktree at our target path (e.g. tried it manually), `git worktree add` fails. Detect and adopt instead of failing — same code path as launcher-restart adoption.
- **Branch list is slow on big repos.** `git branch -a` is fast; `git fetch` is not. We don't fetch — accept the staleness.
- **csproj drift.** If someone reverts the `UseLocalXml` conditional on the server's main, repo-mode silently uses NuGet XML even when the user opted into a local branch. Mitigation: at build time, sniff the csproj for the `UseLocalXml` token; if absent, refuse to launch with a friendly error pointing at the server commit that adds it.
- **MSBuild caching across worktrees.** Two worktrees of the same repo can share `obj/`/`bin/` if their relative paths differ — they shouldn't, since each worktree has its own `obj/` under itself. Verify in testing that switching between two branch instances doesn't cross-contaminate builds.
- **Path length on Windows.** `<repo>/.worktrees/feature__some-long-branch-name/hybrasyl/obj/Debug/net10.0/…` can exceed 260 chars on default Windows. Document the long-path-enabled requirement (or fail with a helpful message pointing at the registry key), don't try to auto-handle it.
- **First-build silence.** "Starting…" for 60s with no feedback feels broken. The Building→Running state flip mitigates, but if `dotnet restore` itself fails (network down, NuGet source unreachable), the user sees "Building…" forever until eventual stderr surfaces. Cap with a heartbeat in the line buffer: if no output in 90s, surface a warning Snackbar.

---

## Verification

1. **`npm test`** — new `worktreeManager`, `buildProps`, `gitOps` test files green; `serverTarget` repo-mode cases green; `settingsManager` default-fill case green.
2. **Server-side prereq merged.** Confirm `feature/epona-branch-instances` is on the server's main (or at least the commit `11bc748` content) before user-visible testing — repo mode without it just fails MSBuild on `UseLocalXml` evaluation.
3. **`npm run dev`**, Hybrasyl Server tab, with `worldDataDir = E:/Dark Ages Dev/Repos/ceridwen` and a Memurai-backed Redis at `127.0.0.1:6379`:
   - **Layout:** confirm at 800px the form fits without internal scrolling in either mode. If repo mode (with "use local XML" on) overflows, switch to the sub-tab fallback before merging.
   - **Binary mode regression:** existing instance still launches identically to Stage 3.0.
   - **Memurai tip:** hover the help icon next to the Redis caption — tooltip shows the install command. Trigger a Redis-unreachable error (point at `127.0.0.1:6379` with Memurai stopped) — Snackbar message includes the Memurai hint.
   - **Repo mode, server only (NuGet XML):** create a new instance, mode = repo, point at `E:/Dark Ages Dev/Repos/server`, branch = `main`. Start. Confirm Building… → Running. Confirm a worktree exists at `server/.worktrees/main/`. Stop. Confirm the worktree is removed (clean shutdown).
   - **Repo mode, server + local XML:** same instance, check "Use local XML branch", point at `E:/Dark Ages Dev/Repos/xml`, branch = `develop`. Start. Confirm `Directory.Build.props` exists at `server/.worktrees/main/Directory.Build.props` with the correct `LocalXmlProjectPath` (`xml/.worktrees/develop/src/Hybrasyl.Xml.csproj`). Confirm the server build references the local XML by inspecting build output for `Hybrasyl.Xml -> …\.worktrees\develop\src\bin\…\Hybrasyl.Xml.dll`. Stop. Confirm both worktrees + `Directory.Build.props` are removed.
   - **Two instances, same branch, refcount sharing:** create a second instance also on `server/main`. Start both. Confirm only one worktree directory exists. Stop one — worktree stays. Stop the other — worktree removed.
   - **Adoption across launcher restart:** start an instance, fully close Epona (which fires `before-quit` and *does* release), confirm clean. Then reach into the on-disk worktrees directly and create one Epona doesn't know about (`git worktree add server/.worktrees/manual <some-branch>`); reopen Epona; create an instance on that branch; confirm Epona adopts the worktree (refcount = 1, no second `git worktree add` attempt).
   - **Special case: serverBranch = null:** instance with mode=repo, server repo path set, server branch = "(current checkout)". Start. Confirm no worktree is created and the spawn cwd is the repo root itself.
   - **csproj drift guard:** check out a server branch that lacks the `UseLocalXml` conditional, set xmlBranch on the instance, Start. Confirm friendly error mentions the missing csproj support and the required commit.
4. **`npm run build`** — clean.

---

## End state

Server tab supports two instance modes:
- **Binary** — Stage 3.0 behavior preserved verbatim
- **Repo** — point at server repo + branch (and optionally XML repo + branch); Epona ensures git worktrees per branch, writes a build-props redirect for local XML when requested, and `dotnet run`s the server from the worktree. Multiple instances on the same branch share a worktree via refcount.

The UI fits at 800px tall with mode-conditional rendering. Memurai's `winget` install command is reachable from a help tooltip next to the Redis caption. Worktrees and build-overrides are gitignored on the server side (already done) so nothing leaks into commits.

Total upstream surface: zero — server prereqs are already merged on `feature/epona-branch-instances` and just need to land on main. Total Epona surface: 3 new modules (worktreeManager, buildProps, gitOps), 1 mode dispatch in serverTarget, 1 mode toggle + conditional sections in ServerInstancePanel, 1 height bump. No new dependencies.
