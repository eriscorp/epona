# Epona Multi-Target Expansion — Staged Branch Plan

## Context

Epona today is a single-purpose Electron launcher for the **legacy Dark Ages client**: it spawns the client suspended, writes patches into its process memory via the custom `da-win32` N-API addon, then resumes. The codebase is hardcoded to that one target — `clientVersions.js` carries DA-specific patch offsets, `serverTester.js` speaks DA's wire protocol, and the profile/UI shape assumes a single launchable.

The goal is to grow Epona into the single control plane for the broader Hybrasyl ecosystem on a developer or server-op's Windows machine, covering three workloads:

1. Legacy DA client launching (today's behavior, preserved)
2. **Hybrasyl client** launching — `Chaos.Client` (sibling repo `e:\Dark Ages Dev\Repos\chaos.client`), a C# / .NET 10 / MonoGame application
3. **Hybrasyl server** instance creation/management — sibling repo `e:\Dark Ages Dev\Repos\server`, a C# / .NET 10 service requiring Redis at runtime

Each stage is its own branch off `main`, merged when complete. End state: a tabbed launcher where one user installs Epona once and uses it for the whole stack.

---

## Stage decisions

- **No Stage 0 refactor.** Land Chaos.Client as a parallel code path in Stage 2 with minimal sharing; extract a `targets/*` abstraction in Stage 3 once we have three concrete data points (legacy + Chaos + server). Avoids designing the abstraction against a sample of one.
- **No bundling of binaries.** Epona ships only the launcher. For Chaos.Client and the server, the user supplies either a prebuilt artifact path *or* a path to the local source repo — Epona handles both.
- **Chaos.Client endpoint**: Stage 2 templates `Darkages.cfg` to drive the endpoint per profile. Requires a small paired upstream change in `chaos.client` so `GlobalSettings` reads `LobbyHost`/`LobbyPort` from the cfg. Track that as a coordinated dependency.
- **Server v1**: Manual config — user provides a world data dir; `config.xml` is resolved automatically as `<worldDataDir>/world/xml/serverconfig` (creation/maintenance of those XML files is owned by the sibling `creidhne` tool, not Epona). Epona starts/stops, sets `HYB_*` env vars, tails Serilog output, adopts running PIDs on relaunch. No XML templating in v1.
- **Redis**: User prerequisite. Epona detects local Memurai/Valkey installs and offers to start them when stopped (service start, or spawn the binary as a managed child). If no install is discovered, TCP-probe the configured remote host:port and fail fast with a clear install link if unreachable.

---

## Stage 1 — Legacy baseline + multi-target seam

**Branch:** `stage/1-legacy-seam`
**Goal:** No behavior change for existing users. Introduce the seam Stage 2 plugs into.

**Changes:**

- [src/main/settingsManager.js](../src/main/settingsManager.js) — add `targetKind: 'legacy'` field with migration; profile shape stays shared (hostname/port works for both legacy and Chaos)
- [src/main/index.js](../src/main/index.js) — make the `launch` IPC accept and dispatch on `targetKind` (only `'legacy'` handled for now)
- [src/preload/index.js](../src/preload/index.js) — pass `targetKind` through `sparkAPI.launch`
- [src/renderer/src/App.jsx](../src/renderer/src/App.jsx) — wrap content in MUI `Tabs` with a single "Legacy Client" tab visible

**Out of scope:** Splitting `launcher.js` into a target module. That refactor lives in Stage 3.

**Verification:** Existing settings file at `%APPDATA%\Erisco\Epona\settings.json` upgrades cleanly; launching the legacy client behaves identically to current `main`.

---

## Stage 2 — Chaos.Client launching

**Branch:** `stage/2-chaos-client`
**Goal:** A "Hybrasyl Client" tab. User points it at either a prebuilt `Chaos.Client.exe` or the local `chaos.client` repo, picks a profile, hits Launch. Profile hostname/port is templated into `Darkages.cfg` before spawn.

**New files:**

- `src/main/targets/chaosLauncher.js` — entry point. Detects whether the configured path is an exe or a repo (presence of `.csproj`/`.sln`). For exe: `child_process.spawn(exePath, [], { cwd: dirname(exePath), detached: true })`. For repo: `dotnet run --project <project> --configuration Debug` from the repo root. Pipe stdout/stderr to the main-process logger.
- `src/main/chaosConfig.js` — read/write the INI-style `Darkages.cfg` at the user-configured data path (default `E:\Games\Dark Ages`). Only touch the keys we own (`LobbyHost`, `LobbyPort`); preserve everything else.
- `src/main/runtimeCheck.js` — shell `dotnet --list-runtimes`, parse for `Microsoft.NETCore.App 10.*`. Surface a friendly error with a download link if missing.
- `src/renderer/src/components/ChaosOptionsPanel.jsx` — mirrors [src/renderer/src/components/OptionsPanel.jsx](../src/renderer/src/components/OptionsPanel.jsx). Fields: client path (file or folder picker), data path. Reuse `ProfileSelector`, `ActionButtons`, `SettingsDrawer` unchanged.

**Modified files:**

- [src/main/settingsManager.js](../src/main/settingsManager.js) — add `settings.targets.chaos = { clientPath, dataPath }`
- [src/main/index.js](../src/main/index.js) — dispatch `targetKind === 'chaos'` to `chaosLauncher`
- [src/preload/index.js](../src/preload/index.js) — add `detectChaosPath`, `pickChaosPath`, `readChaosCfg`, `writeChaosCfg`, `checkDotnetRuntime`
- [src/renderer/src/App.jsx](../src/renderer/src/App.jsx) — second tab "Hybrasyl Client"

**Reused:**

- `serverTester.js` works as-is for Chaos endpoints (same wire protocol)
- Profile shape (hostname/port) shared with legacy

**Coordinated upstream change:** Open a PR against `chaos.client` so `GlobalSettings` reads `LobbyHost`/`LobbyPort` from `Darkages.cfg` instead of compile-time constants. Document the minimum required Chaos.Client commit/version in Epona's README.

**Risks:**

- Chaos.Client may use a single-process lockfile; verify before exposing a multiple-instance toggle
- `dotnet run` from repo path is slow on first invocation (restore + build); show a "Building…" spinner when path is a repo

**Verification:** Launch with both an exe path and a repo path; confirm the spawned process connects to the profile's hostname (requires the upstream Chaos.Client patch landed).

---

## Stage 3 — Hybrasyl server instance management

**Reshape from original plan:** the sibling server repo now carries a branch-aware XML override hook (see [server/docs/epona-branch-instances.md](../../server/docs/epona-branch-instances.md)) — `Hybrasyl.csproj` conditionally swaps its `Hybrasyl.Xml` NuGet reference for a `ProjectReference` when `UseLocalXml=true`, which Epona injects via a generated `Directory.Build.props`. That upgrades Stage 3 from "manual config, no XML" (original v1) to end-to-end branch-aware worktree management. To keep reviews tractable, Stage 3 is split:

### Stage 3.0 — Foundations (binary mode + refactor)

**Branch:** `stage/3.0-server-instances-binary`
**Goal:** "Hybrasyl Server" tab with multi-instance CRUD and **binary-mode launches only**. User points each instance at a prebuilt `Hybrasyl.dll` (or self-contained `.exe`), configures Redis + ports + dirs, clicks Start, watches logs in the shared LogPane. Repo-mode fields exist in the schema but are gated off (`validateForLaunch` rejects them) so 3.1 can layer in without settings churn.

**Now the target-file reorg pays off** — three real targets means the folder layout is grounded rather than speculative. The plan-original `TargetBase.js` common interface is dropped; the three launch functions already share a close-enough shape (`launch(config, ...) → { success, pid?, error?, child? }`) that a formal interface adds more ceremony than value.

**New files (3.0):**

- `src/main/targets/serverTarget.js` — binary-mode launch. `resolveConfigFile` derives `<worldDataDir>/world/xml/serverconfig/config.xml`. `buildBinarySpawn` branches on extension: `.dll` wraps with `dotnet <dll>`, `.exe` runs directly. Env injects `HYB_REDIS_HOST`/`HYB_REDIS_PORT`. `validateForLaunch` rejects repo-mode (deferred) and missing fields with a friendly error.
- `src/main/redisProbe.js` — TCP probe with short timeout. Returns `{ ok, error? }`. No shell-out discovery in 3.0 — unreachable Redis fails fast with a clear install-link message.
- `src/renderer/src/components/ServerInstancePanel.jsx` — instance dropdown + Add/Delete + Console-toggle icon + detail form (name, binary path, world/log dirs, redis host:port, port triplet) + Start/Stop button. Fields disabled when the instance is running.

**Moved files (3.0):**

- `src/main/launcher.js` → `src/main/targets/legacyTarget.js` (import path updated)
- `src/main/targets/hybrasylLauncher.*` → `src/main/targets/hybrasylTarget.*` (naming symmetry)

**Modified files (3.0):**

- [src/main/settingsManager.js](../src/main/settingsManager.js) — adds `instances: []` + `activeInstance` to DEFAULTS, a `coerceInstance` per-field coercer, and the exported `DEFAULT_INSTANCE` schema with all final fields (repo-mode branch fields present but unused in 3.0).
- [src/main/index.js](../src/main/index.js) — new IPC handlers: `instance:start` (spawns via `serverTarget.launch`, tracks child in `Map<id, ChildProcess>`, wires log pipes), `instance:stop` (kills tracked child), `instance:listRunning`, generic `dialog:openFile`/`dialog:openDirectory` for reuse. Emits `instance:log`/`instance:childExit` events tagged with `instanceId`.
- [src/preload/index.js](../src/preload/index.js) — `startInstance`, `stopInstance`, `listRunningInstances`, `pickFile`, `pickDirectory`, `onInstanceLog`, `onInstanceChildExit`.
- [src/renderer/src/App.jsx](../src/renderer/src/App.jsx) — third tab "Hybrasyl Server". Per-instance log buffers (`instanceLogs: {id: lines[]}`), `runningInstances: Set<id>`. LogPane routes to the active kind of tab (client vs instance) based on `activeTab`.

**Lifecycle behavior (3.0):**

- **Start:** validate instance config → TCP-probe Redis → if unreachable, fail fast with an install-link error. Spawn server, wire stdio to per-instance line-buffered log events, track child in the Map.
- **Stop:** `child.kill()` (Windows SIGTERM-equivalent). `/shutdown` via admin socket remains an open upstream question.
- **Parent-exit behavior:** server children are not detached, but on Windows they survive Epona's exit by default. Logs stop flowing when Epona closes (pipes go away) — re-starting Epona won't reattach to the orphan.

**Deferred (Stage 3.1+):**

- Repo-mode launches + worktree manager + `Directory.Build.props` generation (see 3.1 below)
- Local Redis discovery + "offer to start" (Memurai/Valkey service + binary detection)
- PID-file adoption across launcher restarts
- Graceful `/shutdown` over an admin socket (upstream work)
- Port-collision detection across instances
- Bundled Redis

**Verification (3.0):**

- Start an instance with a prebuilt `Hybrasyl.dll`; confirm `dotnet <dll>` spawns, logs stream into the LogPane, server listens on the configured port triplet.
- Start an instance with a self-contained `Hybrasyl.exe`; confirm the exe runs directly (no `dotnet` wrapper), logs stream the same way.
- Start two instances against the same world data dir with distinct port triplets; confirm both run and logs are routed per-instance by id.
- Stop one; confirm the other survives and its LogPane stays live.
- With Redis unreachable, attempt to start; confirm the error mentions `redisHost:redisPort` and the fallback guidance.

### Stage 3.1 — Branch-aware repo mode

**Branch:** `stage/3.1-server-worktrees`
**Goal:** Repo-mode launches. User picks a server branch (+ optionally an XML branch); Epona creates git worktrees on demand, generates a gitignored `Directory.Build.props` in the server worktree when local XML is requested, runs `dotnet run --project`, and cleans up worktrees on instance stop/delete.

**New files:**

- `src/main/worktreeManager.js` — `ensureWorktree(repoPath, branch) → { path, release }`, ref-counted sharing across instances on the same branch. Shells out to `git -C <repo> worktree add -B <branch> <.worktrees/sanitized> <branch>` and `git worktree remove` on release. Path sanitization strips `/`, `\`, `..`.
- `src/main/buildProps.js` — write/delete `<serverWorktree>/Directory.Build.props` with `UseLocalXml=true` + `LocalXmlProjectPath=<xmlWorktree>/src/Hybrasyl.Xml.csproj` when local XML is requested; no-op when xmlBranch is null.

**Modified files:**

- `src/main/targets/serverTarget.js` — lift the `mode === 'repo'` gate; orchestrate: ensure server worktree → (if xmlBranch) ensure xml worktree + write props → `dotnet run --project <worktree>/hybrasyl/Hybrasyl.csproj` → on exit, release worktrees and delete props.
- `src/main/index.js` — `instance:stop` plumbs worktree release; new `instance:listBranches(repoPath)` for UI branch pickers.
- `ServerInstancePanel.jsx` — mode toggle (binary/repo), server repo path + branch dropdown, xml repo path + branch dropdown.

**Verification (3.1):**

- Create two instances on different server branches pointing at the same server repo; confirm they share nothing and their worktrees land at `server/.worktrees/<branch>/`.
- Create two instances on the same server branch; confirm they share one worktree.
- Enable local XML with different xml branches per instance; confirm each server's `Directory.Build.props` points at its instance's XML worktree.
- Delete an instance; confirm its worktree is released and removed if no other instance references it.
- Confirm `Directory.Build.props` is cleaned up on stop so a subsequent NuGet-mode run doesn't inherit `UseLocalXml=true`.

---

## End state

Three tabs in one Electron app: legacy DA client (behavior preserved), Hybrasyl client (Chaos.Client launched against any profile via templated `Darkages.cfg`), Hybrasyl server (multi-instance start/stop/log-tail against user-supplied Redis). All three accept either a prebuilt binary path or a sibling repo path. Replaces hand-rolled batch files, source-edited endpoints, and memorized `dotnet` invocations — without bundling anything Epona doesn't own.

---

## Critical files to know

- [src/main/index.js](../src/main/index.js) — IPC entry, target dispatcher
- [src/main/targets/legacyTarget.js](../src/main/targets/legacyTarget.js) — legacy Dark Ages client launcher (memory-patched via `da-win32`)
- [src/main/settingsManager.js](../src/main/settingsManager.js) — settings persistence, profile shape, instance list
- [src/main/clientVersions.js](../src/main/clientVersions.js) — legacy DA patch offsets (untouched by this work)
- [src/main/serverTester.js](../src/main/serverTester.js) — DA-protocol connection tester (reused for Chaos)
- [src/preload/index.js](../src/preload/index.js) — `sparkAPI` surface
- [src/renderer/src/App.jsx](../src/renderer/src/App.jsx) — root component, tab host
- [src/renderer/src/components/](../src/renderer/src/components/) — existing UI parts (`ProfileSelector`, `OptionsPanel`, `ActionButtons`, `SettingsDrawer`, `TitleBar`)
- [packages/da-win32/src/addon.cc](../packages/da-win32/src/addon.cc) — Win32 interop for legacy patching (untouched)
