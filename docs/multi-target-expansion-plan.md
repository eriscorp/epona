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

## Stage 3 — Hybrasyl server instance management + Target abstraction extraction

**Branch:** `stage/3-server-instances`
**Goal:** A "Hybrasyl Server" tab. User creates named server instances, configures each (binary or repo path, world data dir, log dir, Redis host:port, port triplet), Start/Stop them, watches a live log tail. `config.xml` is resolved automatically as `<worldDataDir>/world/xml/serverconfig` — no separate field, since `creidhne` (sibling tool) owns creation/maintenance of those XML files. Instances persist across launcher restarts; running PIDs are adopted on reopen.

**Now the abstraction refactor pays off** — three real targets means the interface is grounded in actual cases, not speculation.

**New files:**

- `src/main/targets/TargetBase.js` — interface contract: `launch(config, profile) → { pid, stop(), onLog(cb) }`
- `src/main/targets/legacyTarget.js` — move existing patching logic from [src/main/launcher.js](../src/main/launcher.js) here, behaviorally unchanged
- `src/main/targets/chaosTarget.js` — move Stage 2 `chaosLauncher.js` content here
- `src/main/targets/serverTarget.js` — new. Resolves binary-vs-repo (same detection helper as Chaos). Derives `configFile` as `<worldDataDir>/world/xml/serverconfig/config.xml` (or whatever `serverconfig` actually contains — confirm at implementation time). For binary: `dotnet hybrasyl.dll --configFile <derived> --worldDataDir ... --logDir ...` with `HYB_REDIS_HOST`/`HYB_REDIS_PORT` in env. For repo: `dotnet run --project hybrasyl/Hybrasyl.csproj -- --configFile <derived> --worldDataDir ... --logDir ...`. Writes a PID file under `%APPDATA%\Erisco\Epona\instances\<id>\hybrasyl.pid`.
- `src/main/instanceManager.js` — CRUD over `settings.instances[]`. On startup, walk each instance's PID file and check liveness (`tasklist /FI "PID eq <pid>"`); adopt or clear stale entries.
- `src/main/redisProbe.js` — two responsibilities: (1) TCP connect with short timeout to `host:port`, return `{ ok, error }`; (2) on a localhost target, discover local Memurai/Valkey via Windows service query (`sc query Memurai`, `sc query Valkey`) and binary lookup (`where redis-server.exe`, `where memurai.exe`). Return `{ installed, serviceName?, binaryPath?, running }` so the UI can offer to start it.
- `src/main/redisManager.js` — start a discovered local install when the user asks. If a service is present and stopped: `sc start <name>` (may require elevation — surface that requirement in the UI). If only a binary is present: spawn it as a managed child process under Epona's lifetime, scoped to that instance (or shared across instances with refcounting).
- `src/renderer/src/components/ServerInstanceList.jsx` — left pane: list with add/delete
- `src/renderer/src/components/ServerInstanceDetail.jsx` — right pane: form fields + Start/Stop button + scrollable log pane (MUI `Paper` + `TextField multiline readOnly`, ring-buffered to ~5k lines, with a "Open log file" button to the on-disk Serilog output)

**Modified files:**

- [src/main/index.js](../src/main/index.js) — becomes a thin dispatcher over `targets/*`; new IPC handlers `listInstances`, `createInstance`, `updateInstance`, `deleteInstance`, `startInstance`, `stopInstance`
- [src/main/launcher.js](../src/main/launcher.js) — emptied (logic moved to `legacyTarget.js`); deleted if no remaining call sites
- [src/preload/index.js](../src/preload/index.js) — expose the new instance IPC; add `onInstanceLog(id, cb)` event subscription using `ipcRenderer.on` against per-instance channels (`instance:log:<id>`)
- [src/renderer/src/App.jsx](../src/renderer/src/App.jsx) — third tab "Hybrasyl Server"

**Lifecycle behavior:**

- Start: probe Redis first. If reachable → continue. If unreachable AND a local install is discovered → prompt the user with "Start <Memurai|Valkey> (service|process)?"; on confirm, start it via `redisManager`, re-probe, then continue. If unreachable and no local install discovered → fail fast with an install link. After Redis is ready, spawn the server process and pipe logs to the instance's ring buffer + per-instance file (Serilog also writes its own).
- Stop: `taskkill /PID <pid>` (Windows equivalent of SIGTERM); document that in-game `/shutdown` is the only fully graceful path until the server exposes an external admin endpoint. If Epona started Redis itself for this instance, refcount-decrement on stop and shut Redis down when no instances reference it (only for spawn-as-child mode; never auto-stop a service Epona started, since it may be relied on by other tools).
- Adoption: on Epona launch, check each PID file; if process is alive, attach (logs from this point forward only — historical logs remain on disk).

**Out of scope (deferred to a follow-up `stage/3.1-server-templates` branch):**

- Any XML editing — that's `creidhne`'s job; v1 only consumes what's already there
- Port-collision detection across instances
- Graceful `/shutdown` over an admin socket (likely needs upstream server work)
- Bundled Redis

**Risks:**

- PID-file adoption may be flaky if processes are killed without cleanup; design `instanceManager` to tolerate stale files and surface "stopped (stale PID)" state in the UI
- Multiple instances against shared world data: confirm the server treats `--worldDataDir` as read-only (no on-disk caching of parsed XML there)
- Log volume: cap the in-UI ring buffer at ~5k lines; always link to the on-disk file
- Per-instance Redis vs shared Redis: shared is safe per server-GUID partitioning; document this so users don't over-provision

**Verification:**

- Create two instances pointing at the same world data dir, distinct port triplets, shared Redis. Start both; connect a Chaos.Client (Stage 2) to each. Stop one; confirm the other survives. Restart Epona while both are running; confirm both are adopted with correct status.
- Repeat the above with one instance pointing at a prebuilt `Hybrasyl.dll` and the other at the `server` repo source — both paths must work.
- Kill an instance externally (Task Manager); confirm Epona surfaces `stopped (stale PID)` and lets the user restart cleanly.
- With Redis installed locally but stopped, attempt to start an instance; confirm Epona offers to start it and continues cleanly after the user accepts.
- With Redis not installed at all, attempt to start an instance against `localhost`; confirm fail-fast with the install-link error.

---

## End state

Three tabs in one Electron app: legacy DA client (behavior preserved), Hybrasyl client (Chaos.Client launched against any profile via templated `Darkages.cfg`), Hybrasyl server (multi-instance start/stop/log-tail against user-supplied Redis). All three accept either a prebuilt binary path or a sibling repo path. Replaces hand-rolled batch files, source-edited endpoints, and memorized `dotnet` invocations — without bundling anything Epona doesn't own.

---

## Critical files to know

- [src/main/index.js](../src/main/index.js) — IPC entry, target dispatcher
- [src/main/launcher.js](../src/main/launcher.js) — current legacy launcher (becomes `targets/legacyTarget.js` in Stage 3)
- [src/main/settingsManager.js](../src/main/settingsManager.js) — settings persistence, profile shape, instance list
- [src/main/clientVersions.js](../src/main/clientVersions.js) — legacy DA patch offsets (untouched by this work)
- [src/main/serverTester.js](../src/main/serverTester.js) — DA-protocol connection tester (reused for Chaos)
- [src/preload/index.js](../src/preload/index.js) — `sparkAPI` surface
- [src/renderer/src/App.jsx](../src/renderer/src/App.jsx) — root component, tab host
- [src/renderer/src/components/](../src/renderer/src/components/) — existing UI parts (`ProfileSelector`, `OptionsPanel`, `ActionButtons`, `SettingsDrawer`, `TitleBar`)
- [packages/da-win32/src/addon.cc](../packages/da-win32/src/addon.cc) — Win32 interop for legacy patching (untouched)
