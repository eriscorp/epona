import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { dirname } from 'path'
import { writeCfg } from '../hybrasylConfig.js'

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
  if (lower.endsWith('.exe')) {
    return { kind: 'exe', exePath: configuredPath, cwd: dirname(configuredPath) }
  }
  if (lower.endsWith('.csproj')) {
    return { kind: 'repo', csprojPath: configuredPath, cwd: dirname(configuredPath) }
  }
  return { kind: 'invalid', reason: 'path must be a .exe or .csproj file' }
}

// Pure: shape the command/args/cwd for child_process.spawn based on a resolved path.
export function buildSpawnArgs(resolved) {
  if (resolved.kind === 'exe') {
    return { command: resolved.exePath, args: [], cwd: resolved.cwd }
  }
  if (resolved.kind === 'repo') {
    return {
      command: 'dotnet',
      args: ['run', '--project', resolved.csprojPath, '--configuration', 'Debug'],
      cwd: resolved.cwd
    }
  }
  throw new Error(`cannot build spawn args for resolved kind '${resolved.kind}'`)
}

// Orchestration: write Darkages.cfg with the profile endpoint, then spawn the
// client. Two launch modes by kind:
//   exe  → fire-and-forget, stdio ignored, multiple instances allowed.
//          `child` is not returned; main does no tracking.
//   repo → stdio piped so the LogPane can tail `dotnet run` output. Singleton
//          — main kills a previous repo child before starting a new one.
// Windows-specific: no `detached: true`, which would otherwise attach the
// child to a new console group (dodges windowsHide and disconnects our pipes).
// Children survive Epona's exit by default on Windows, which is what we want.
export async function launch(config, profile) {
  const resolved = await resolvePath(config.clientPath)
  if (resolved.kind === 'invalid') {
    return { success: false, error: `Client path invalid: ${resolved.reason}` }
  }

  try {
    await writeCfg(config.dataPath, {
      LobbyHost: profile.hostname,
      LobbyPort: String(profile.port)
    })
  } catch (err) {
    return {
      success: false,
      error: `Failed to write Darkages.cfg in ${config.dataPath}: ${err.message}`
    }
  }

  const isRepo = resolved.kind === 'repo'
  const { command, args, cwd } = buildSpawnArgs(resolved)
  try {
    const child = spawn(command, args, {
      cwd,
      stdio: isRepo ? ['ignore', 'pipe', 'pipe'] : 'ignore',
      windowsHide: !config.showConsole
    })
    return {
      success: true,
      pid: child.pid,
      kind: resolved.kind,
      child: isRepo ? child : null
    }
  } catch (err) {
    return { success: false, error: `Failed to spawn client: ${err.message}` }
  }
}
