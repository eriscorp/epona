import { spawn } from 'child_process'
import { join } from 'path'
import { check as redisCheck } from '../redisProbe.js'
import { readDataStore } from '../serverConfigs.js'

// Resolve the on-disk path a user's configFileName selection points at.
// Useful for UI "file exists?" checks; the server itself doesn't need the
// full path — it takes `--config <name>` and resolves inside `--datadir`.
export function resolveConfigFile(worldDataDir, configFileName = 'config.xml') {
  return join(worldDataDir, 'xml', 'serverconfigs', configFileName)
}

// Strip a case-insensitive .xml suffix; the server's `--config` flag wants
// the bare name (e.g. "local"), not the filename ("local.xml").
export function stripXmlExt(name) {
  return typeof name === 'string' ? name.replace(/\.xml$/i, '') : ''
}

// Pure: build the { command, args, env } the server should be spawned with
// for a binary-mode instance. Accepts either a built .dll (wrapped by
// `dotnet <dll>`) or a self-contained .exe (invoked directly). Flags match
// the server's System.CommandLine options (lowercase; see `Hybrasyl --help`):
//   --datadir  <dir>   The data directory (our "worldDataDir" setting)
//   --logdir   <dir>   Log output directory
//   --config   <name>  Named config in <datadir>/xml/serverconfigs/
// --worlddatadir is left unset; the server defaults it to DATADIR\xml.
// Redis env vars are only emitted when instance.redisHost is populated —
// a blank override means "read DataStore from the config XML" (Game.cs:579-592).
export function buildBinarySpawn(instance) {
  const env = {}
  if (instance.redisHost) {
    env.HYB_REDIS_HOST = instance.redisHost
    env.HYB_REDIS_PORT = String(instance.redisPort)
    if (instance.redisDatabase != null) env.HYB_REDIS_DB = String(instance.redisDatabase)
    if (instance.redisPassword) env.HYB_REDIS_PASSWORD = instance.redisPassword
  }
  const args = [
    '--datadir', instance.worldDataDir,
    '--logdir', instance.logDir,
    '--config', stripXmlExt(instance.configFileName)
  ]
  const isExe = /\.exe$/i.test(instance.binaryPath)
  if (isExe) return { command: instance.binaryPath, args, env }
  return { command: 'dotnet', args: [instance.binaryPath, ...args], env }
}

// Decide where to probe Redis before launch:
//  - If the instance overrides redisHost, probe that (the user's explicit choice).
//  - Else read <DataStore> from the selected server config XML and probe
//    whatever the server is about to use.
//  - Else return null → skip the probe (the server will error clearly enough).
// Returns { host, port, source } or null.
export async function resolveRedisTarget(instance) {
  if (instance.redisHost) {
    return { host: instance.redisHost, port: instance.redisPort, source: 'instance override' }
  }
  const ds = await readDataStore(instance.worldDataDir, instance.configFileName)
  if (ds) return { host: ds.host, port: ds.port, source: 'config XML DataStore' }
  return null
}

// Friendly-message preflight: is every field the launcher actually needs
// populated? Returns { ok: true } or { ok: false, error }.
export function validateForLaunch(instance) {
  if (instance.mode !== 'binary') {
    return { ok: false, error: 'Repo-mode launches arrive in Stage 3.1 — use binary mode for now' }
  }
  if (!instance.binaryPath) return { ok: false, error: 'binaryPath is not set' }
  if (!instance.worldDataDir) return { ok: false, error: 'worldDataDir is not set' }
  if (!instance.logDir) return { ok: false, error: 'logDir is not set' }
  if (!instance.configFileName) return { ok: false, error: 'configFileName is not set' }
  return { ok: true }
}

// Orchestration: validate the instance config, probe Redis, spawn the server
// with stdio piped so main/index.js can tail logs per-instance. We don't
// detach — on Windows the child survives the parent by default, and piped
// stdio needs our process alive anyway to drain the pipes.
export async function launch(instance) {
  const valid = validateForLaunch(instance)
  if (!valid.ok) return { success: false, error: valid.error }

  const redisTarget = await resolveRedisTarget(instance)
  if (redisTarget) {
    const redis = await redisCheck(redisTarget.host, redisTarget.port)
    // authRequired: Redis answered RESP but demands credentials. The server
    // will do the auth using XML/env password, so we let it proceed.
    if (!redis.ok) {
      const isLoopback =
        redisTarget.host === 'localhost' ||
        redisTarget.host === '127.0.0.1' ||
        redisTarget.host === '::1'
      const wslHint = isLoopback
        ? ` WSL tip: try \`wsl --shutdown\` then restart Redis, or point the ` +
          `instance at the WSL VM IP from \`wsl hostname -I\`.`
        : ''
      return {
        success: false,
        error:
          `Redis unreachable at ${redisTarget.host}:${redisTarget.port} ` +
          `(${redis.error}; from ${redisTarget.source}). ` +
          `Start Memurai/Valkey or point the instance at a reachable Redis.` +
          wslHint
      }
    }
  }
  // When redisTarget is null, neither the instance nor the XML specifies Redis;
  // let the server surface the fatal itself rather than blocking here.

  // Pre-flight: fail fast if the lobby port is already occupied. This catches
  // orphaned server instances that the user hasn't stopped — without this the
  // server crashes on bind deep in its startup and the error scrolls past.
  const portInUse = await redisCheck('127.0.0.1', instance.lobbyPort, 500)
  if (portInUse.ok) {
    return {
      success: false,
      error:
        `Port ${instance.lobbyPort} is already in use — probably a leftover server ` +
        `from an earlier launch. Stop it (or kill dotnet.exe in Task Manager) and retry.`
    }
  }

  const { command, args, env } = buildBinarySpawn(instance)
  try {
    if (process.platform === 'win32') {
      // Spawn the server in a new PowerShell console window that *waits* for
      // the user after the server exits — so crash traces don't vanish.
      //
      // How it works:
      //   outer powershell.exe (hidden, via windowsHide: true)
      //     → Start-Process powershell.exe (-WindowStyle Normal, new console)
      //       → runs a PS script that: invokes the server, prints "exited",
      //         and blocks on Read-Host so the window stays open.
      //
      // The inner script is passed via -EncodedCommand (base64 UTF-16LE),
      // which bypasses every layer of command-line quoting so paths with
      // spaces and embedded quotes route through cleanly.
      //
      // Trade-off: Node's child handle is the outer PS shim (exits in ms),
      // so we can't track the server PID or pipe its stdio. Stop is manual
      // (close the console). Revisit with -PassThru + taskkill when proper
      // Stop UX becomes important.
      const quote = (s) => `'${String(s).replace(/'/g, "''")}'`

      // The script the new console's PowerShell runs. Uses PS's call
      // operator `&` to invoke a quoted path, then a Read-Host pause.
      const childScript =
        `& ${quote(command)} ${args.map(quote).join(' ')}; ` +
        `$code = $LASTEXITCODE; ` +
        `Write-Host ''; ` +
        `Write-Host ('=== Server exited (code ' + $code + '). Press Enter to close this window. ===') -ForegroundColor Yellow; ` +
        `$null = Read-Host`
      const encodedScript = Buffer.from(childScript, 'utf16le').toString('base64')

      // Outer PS hands the encoded script to the new (visible) PS window and
      // uses -PassThru to capture the spawned process so we can return its
      // PID. Stop later = `taskkill /F /T /PID <pid>` against this PID, which
      // reaps the wrapper and the server it spawned as a tree.
      const outerPs =
        `$ErrorActionPreference='Stop'; ` +
        `$p = Start-Process -FilePath 'powershell.exe' ` +
        `-ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', '${encodedScript}') ` +
        `-WorkingDirectory ${quote(instance.worldDataDir)} ` +
        `-WindowStyle Normal -PassThru; ` +
        `Write-Output $p.Id`

      const shim = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', outerPs
      ], {
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })

      let psStdout = ''
      let psStderr = ''
      shim.stdout.on('data', (c) => { psStdout += c.toString() })
      shim.stderr.on('data', (c) => { psStderr += c.toString() })
      const exitCode = await new Promise((resolve) => {
        shim.once('exit', (code) => resolve(code))
        shim.once('error', () => resolve(-1))
        setTimeout(() => resolve(null), 5000)
      })
      if (exitCode === null) {
        try { shim.kill() } catch { /* already dead */ }
        return { success: false, error: 'PowerShell launch timed out after 5s' }
      }
      if (exitCode !== 0) {
        return {
          success: false,
          error: `PowerShell launch failed (exit ${exitCode}): ${psStderr.trim() || '(no stderr)'}`
        }
      }
      const wrapperPid = parseInt(psStdout.trim(), 10)
      if (!Number.isFinite(wrapperPid) || wrapperPid <= 0) {
        return {
          success: false,
          error: `Could not parse server wrapper PID from PowerShell output: ${psStdout.trim() || '(empty)'}`
        }
      }
      return { success: true, pid: wrapperPid, child: null, tracked: true }
    }

    // Non-Windows placeholder — the ReadKey issue is Windows-specific;
    // keep the original detached/piped shape for future Linux/macOS work.
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child.unref()
    return { success: true, pid: child.pid, child, tracked: true }
  } catch (err) {
    return { success: false, error: `Failed to spawn server: ${err.message}` }
  }
}
