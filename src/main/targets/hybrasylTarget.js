import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { dirname, relative, join, resolve as resolveAbs } from 'path'
import { gitToplevel } from '../gitOps.js'
import { ensureWorktree, releaseWorktree } from '../worktreeManager.js'
import { resolveDotnetPath } from '../dotnet.js'

// Classify the configured path as either a prebuilt client .exe or a .csproj
// inside a source checkout. Returns { kind, ... } where kind is 'exe' | 'repo'
// | 'invalid'. Invalid results carry a human-readable reason.
export async function resolvePath(configuredPath) {
  if (typeof configuredPath !== 'string' || configuredPath.length === 0) {
    return { kind: 'invalid', reason: 'no path configured' }
  }

  let stat
  try {
    stat = await fs.stat(configuredPath)
  } catch {
    return { kind: 'invalid', reason: `path does not exist: ${configuredPath}` }
  }
  if (!stat.isFile()) {
    return { kind: 'invalid', reason: `path is not a file: ${configuredPath}` }
  }

  const lower = configuredPath.toLowerCase()
  if (lower.endsWith('.csproj')) {
    return { kind: 'repo', csprojPath: configuredPath, cwd: dirname(configuredPath) }
  }
  if (lower.endsWith('.dll')) {
    // Framework-dependent build with no apphost — run via `dotnet <dll>`.
    return { kind: 'dll', dllPath: configuredPath, cwd: dirname(configuredPath) }
  }
  if (lower.endsWith('.exe')) {
    return { kind: 'exe', exePath: configuredPath, cwd: dirname(configuredPath) }
  }
  // On macOS/Linux the published client is an apphost with no extension (e.g.
  // `GameClient`). Accept any file carrying an executable bit as a directly
  // spawnable binary. Windows doesn't encode executability in mode bits, so
  // extension-less files fall through to invalid there — which is correct,
  // since a Windows client binary is always a .exe.
  if (process.platform !== 'win32' && (stat.mode & 0o111) !== 0) {
    return { kind: 'exe', exePath: configuredPath, cwd: dirname(configuredPath) }
  }
  return {
    kind: 'invalid',
    reason:
      process.platform === 'win32'
        ? 'path must be a .exe, .dll, or .csproj file'
        : 'path must be an executable, .dll, or .csproj file'
  }
}

// Pure: shape the command/args/cwd for child_process.spawn based on a resolved
// path. `dotnetPath` is the dotnet executable to invoke for dll/repo launches
// (resolved via resolveDotnetPath so GUI launches find it); defaults to the
// bare 'dotnet' for callers/tests that don't care about resolution.
export function buildSpawnArgs(resolved, dotnetPath = 'dotnet') {
  if (resolved.kind === 'exe') {
    return { command: resolved.exePath, args: [], cwd: resolved.cwd }
  }
  if (resolved.kind === 'dll') {
    return { command: dotnetPath, args: [resolved.dllPath], cwd: resolved.cwd }
  }
  if (resolved.kind === 'repo') {
    return {
      command: dotnetPath,
      args: ['run', '--project', resolved.csprojPath, '--configuration', 'Debug'],
      cwd: resolved.cwd
    }
  }
  throw new Error(`cannot build spawn args for resolved kind '${resolved.kind}'`)
}

// Decide which configured path to feed `resolvePath` based on the target's
// mode. Returns null if the mode is unrecognised.
function pathForMode(config) {
  if (config.mode === 'binary') return config.binaryPath
  if (config.mode === 'repo') return config.clientRepoPath
  return null
}

// Orchestration: spawn the client with the lobby host/port + asset path
// passed via env vars. The client picks them up in GlobalSettings.cs
// (DA_HOST / DA_HOST_PORT / DA_ASSET_PATH) with hardcoded fallbacks if absent.
//
// `daClientPath` is the global Dark Ages.exe path (settings.clientPath, set
// via the toolbar's "Locate Client"). DA_ASSET_PATH is its dirname — the
// Hybrasyl client needs to find the Dark Ages asset directory regardless of
// where its own binary or csproj lives.
//
// Two launch modes by mode:
//   binary → fire-and-forget, stdio ignored, multiple instances allowed.
//            `child` is not returned; main does no tracking.
//   repo   → stdio piped so the LogPane can tail `dotnet run` output. Singleton
//            — main kills a previous repo child before starting a new one. If
//            `clientBranch` is set, a git worktree is materialised and the
//            spawn runs against the worktree's csproj; cleanup releases it.
// Windows-specific: no `detached: true`, which would otherwise attach the
// child to a new console group (dodges windowsHide and disconnects our pipes).
// Children survive Epona's exit by default on Windows, which is what we want.
export async function launch(config, profile, daClientPath) {
  if (typeof daClientPath !== 'string' || daClientPath.length === 0) {
    return {
      success: false,
      error:
        process.platform === 'win32'
          ? 'Dark Ages client path not set — use the Locate Client button on the toolbar to pick Dark Ages.exe.'
          : 'Dark Ages assets path not set — use the Locate Assets button on the toolbar to pick a folder containing Dark Ages assets.'
    }
  }

  const configured = pathForMode(config)
  if (configured == null) {
    return { success: false, error: `Unknown mode: ${config.mode}` }
  }
  const resolved = await resolvePath(configured)
  if (resolved.kind === 'invalid') {
    return { success: false, error: `Client path invalid: ${resolved.reason}` }
  }
  // Mode/kind sanity check: the resolved kind must match the requested mode,
  // otherwise the user has a stale binaryPath/clientRepoPath that disagrees
  // with the toggle. Refuse rather than launching the wrong artefact.
  if (config.mode === 'binary' && resolved.kind !== 'exe' && resolved.kind !== 'dll') {
    return { success: false, error: 'Binary mode requires an executable or .dll path' }
  }
  if (config.mode === 'repo' && resolved.kind !== 'repo') {
    return { success: false, error: 'Repo mode requires a .csproj path' }
  }

  const isRepo = resolved.kind === 'repo'

  // Worktree resolution for branch-pinned repo launches. ensureWorktree gives
  // us the worktree path; we rewrite the resolved csproj into the worktree
  // before building spawn args. cleanup() runs on success (after child exit)
  // or on spawn failure to keep refcounts honest. Skip the entire dance when
  // config.noGit is set — the picked csproj isn't inside a git working tree
  // (or git isn't installed) and the launch runs in place from resolved.cwd.
  let worktreePath = null
  let releaseFn = async () => {}
  if (isRepo && config.clientBranch && !config.noGit) {
    try {
      const repoRoot = await gitToplevel(resolved.cwd)
      if (!repoRoot) {
        return {
          success: false,
          error: `csproj is not inside a git repository: ${resolved.csprojPath}`
        }
      }
      worktreePath = await ensureWorktree(repoRoot, config.clientBranch)
      releaseFn = () => releaseWorktree(repoRoot, config.clientBranch)
      const relCsproj = relative(repoRoot, resolveAbs(resolved.csprojPath))
      resolved.csprojPath = join(worktreePath, relCsproj)
      resolved.cwd = dirname(resolved.csprojPath)
    } catch (err) {
      try {
        await releaseFn()
      } catch {
        /* swallow during error recovery */
      }
      return { success: false, error: `Failed to prepare worktree: ${err.message}` }
    }
  }

  // Resolve dotnet only for the launch kinds that need it; a direct binary
  // (exe/apphost) spawn doesn't touch dotnet at all.
  const dotnetPath =
    resolved.kind === 'repo' || resolved.kind === 'dll' ? await resolveDotnetPath() : 'dotnet'
  const { command, args, cwd } = buildSpawnArgs(resolved, dotnetPath)

  // DA_ASSET_PATH is universally needed: the client's fallback is
  // `<binary>/..` which is wrong for both prebuilt-exe and `dotnet run`
  // layouts. DA_HOST / DA_HOST_PORT only override when the active profile
  // is non-empty; without them the client falls back to its hardcoded host.
  //
  // daClientPath is either a file (Windows: Dark Ages.exe) or a directory (how
  // non-Windows users point Epona at their DA assets via "Locate Assets"). Use
  // a directory as-is; for a file, use its containing directory.
  let assetPath = dirname(daClientPath)
  try {
    if ((await fs.stat(daClientPath)).isDirectory()) assetPath = daClientPath
  } catch {
    // Path is gone — keep dirname() and let the client's own fallback cope.
  }
  const env = { ...process.env, DA_ASSET_PATH: assetPath }
  if (profile?.hostname) {
    env.DA_HOST = profile.hostname
    env.DA_HOST_PORT = String(profile.port)
  }

  try {
    const child = spawn(command, args, {
      cwd,
      stdio: isRepo ? ['ignore', 'pipe', 'pipe'] : 'ignore',
      windowsHide: true,
      env
    })
    // For repo launches with a worktree, the cleanup releases the worktree
    // when the child exits. For binary / no-branch repo launches, cleanup is
    // a no-op. The caller is responsible for actually invoking cleanup on
    // child exit (see index.js wireHybrasylChildLogs).
    return {
      success: true,
      pid: child.pid,
      kind: resolved.kind,
      child: isRepo ? child : null,
      cleanup: releaseFn
    }
  } catch (err) {
    try {
      await releaseFn()
    } catch {
      /* swallow during error recovery */
    }
    return { success: false, error: `Failed to spawn client: ${err.message}` }
  }
}
