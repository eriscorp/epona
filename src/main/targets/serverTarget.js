import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { check as redisCheck } from '../redisProbe.js'
import { readDataStore } from '../serverConfigs.js'
import { ensureWorktree, releaseWorktree } from '../worktreeManager.js'
import { writeBuildProps, removeBuildProps } from '../buildProps.js'

// Resolve the on-disk path a user's configFileName selection points at.
// Useful for UI "file exists?" checks; the server itself doesn't need the
// full path — it takes `--config <name>` and resolves inside `--datadir`.
export function resolveConfigFile(dataDir, configFileName = 'config.xml') {
  return join(dataDir, 'xml', 'serverconfigs', configFileName)
}

// Strip a case-insensitive .xml suffix; the server's `--config` flag wants
// the bare name (e.g. "local"), not the filename ("local.xml").
export function stripXmlExt(name) {
  return typeof name === 'string' ? name.replace(/\.xml$/i, '') : ''
}

// Build the env object we pass to the spawned server. Only emits HYB_REDIS_*
// vars when redisHost is populated — a blank override means "read DataStore
// from the config XML" (server: Game.cs:579-592).
function buildEnv(instance) {
  const env = {}
  if (instance.redisHost) {
    env.HYB_REDIS_HOST = instance.redisHost
    env.HYB_REDIS_PORT = String(instance.redisPort)
    if (instance.redisDatabase != null) env.HYB_REDIS_DB = String(instance.redisDatabase)
    if (instance.redisPassword) env.HYB_REDIS_PASSWORD = instance.redisPassword
  }
  return env
}

// Server CLI flags are camelCase (System.CommandLine on .NET 10 is
// case-sensitive). The server takes two distinct path flags:
//   --dataDir       the per-server data dir (scripts, mapfiles, xml/, ssl/, …)
//   --worldDataDir  the inner XML data dir (serverconfigs/, items/, maps/, …)
//                   defaults to %USERPROFILE%/hybrasyl/world independently —
//                   has its own validator, so we must pass it explicitly.
// The instance's `dataDir` field is what the user picks (a ceridwen-style
// layout containing `xml/`, `scripts/`, `mapfiles/`, …) and maps directly to
// --dataDir. --worldDataDir is then `<dataDir>/xml`. --config <name> takes
// the bare config name (no .xml) and resolves under <worldDataDir>/serverconfigs/.
function buildServerArgs(instance) {
  return [
    '--dataDir', instance.dataDir,
    '--worldDataDir', join(instance.dataDir, 'xml'),
    '--logDir', instance.logDir,
    '--config', stripXmlExt(instance.configFileName)
  ]
}

// Pure: build the { command, args, env } the server should be spawned with
// for a binary-mode instance. Accepts either a built .dll (wrapped by
// `dotnet <dll>`) or a self-contained .exe (invoked directly).
export function buildBinarySpawn(instance) {
  const env = buildEnv(instance)
  const args = buildServerArgs(instance)
  const isExe = /\.exe$/i.test(instance.binaryPath)
  if (isExe) return { command: instance.binaryPath, args, env }
  return { command: 'dotnet', args: [instance.binaryPath, ...args], env }
}

// Pure: build the { command, args, env } for a repo-mode instance. Always
// `dotnet run --project <serverWorktree>/hybrasyl/Hybrasyl.csproj -- <server args>`.
// `--no-launch-profile` skips Properties/launchSettings.json (we control env
// via the explicit env block). `--configuration Debug` matches what a
// developer would do interactively.
export function buildRepoSpawn(instance, serverWorktreePath) {
  const env = buildEnv(instance)
  const csproj = join(serverWorktreePath, 'hybrasyl', 'Hybrasyl.csproj')
  return {
    command: 'dotnet',
    args: [
      'run',
      '--project', csproj,
      '--configuration', 'Debug',
      '--no-launch-profile',
      '--',
      ...buildServerArgs(instance)
    ],
    env
  }
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
  const ds = await readDataStore(instance.dataDir, instance.configFileName)
  if (ds) return { host: ds.host, port: ds.port, source: 'config XML DataStore' }
  return null
}

// Sniff the server csproj for the UseLocalXml conditional ProjectReference.
// If a user is on a server branch that doesn't yet have the conditional
// (server commit 11bc748), repo-mode launches with xmlBranch set would
// silently use the NuGet PackageReference — exactly what the user is trying
// NOT to do. Detect and error early with a friendly pointer.
async function csprojSupportsLocalXml(serverWorktreePath) {
  try {
    const csproj = await fs.readFile(
      join(serverWorktreePath, 'hybrasyl', 'Hybrasyl.csproj'),
      'utf-8'
    )
    return csproj.includes('UseLocalXml')
  } catch {
    return false
  }
}

// Friendly-message preflight: is every field the launcher actually needs
// populated for the instance's mode? Returns { ok: true } or { ok: false, error }.
export function validateForLaunch(instance) {
  if (instance.mode !== 'binary' && instance.mode !== 'repo') {
    return { ok: false, error: `Unknown mode: ${instance.mode}` }
  }
  if (!instance.dataDir) return { ok: false, error: 'dataDir is not set' }
  if (!instance.logDir) return { ok: false, error: 'logDir is not set' }
  if (!instance.configFileName) return { ok: false, error: 'configFileName is not set' }

  if (instance.mode === 'binary') {
    if (!instance.binaryPath) return { ok: false, error: 'binaryPath is not set' }
    return { ok: true }
  }

  // repo mode
  if (!instance.serverRepoPath) return { ok: false, error: 'serverRepoPath is not set' }
  // serverBranch === null is allowed — means "use current checkout in place"
  if (instance.xmlBranch && !instance.xmlRepoPath) {
    return { ok: false, error: 'xmlRepoPath is required when xmlBranch is set' }
  }
  return { ok: true }
}

// Spawn `command args` inside a new visible PowerShell console window that
// pauses on Read-Host after exit so crash traces don't vanish. Returns
// { success, pid } where pid is the wrapper PID (taskkill /F /T against it
// reaps the whole tree). Used by both binary and repo modes.
async function spawnInPowerShellConsole({ command, args, env, cwd }) {
  const quote = (s) => `'${String(s).replace(/'/g, "''")}'`

  const childScript =
    `& ${quote(command)} ${args.map(quote).join(' ')}; ` +
    `$code = $LASTEXITCODE; ` +
    `Write-Host ''; ` +
    `Write-Host ('=== Server exited (code ' + $code + '). Press Enter to close this window. ===') -ForegroundColor Yellow; ` +
    `$null = Read-Host`
  const encodedScript = Buffer.from(childScript, 'utf16le').toString('base64')

  const outerPs =
    `$ErrorActionPreference='Stop'; ` +
    `$p = Start-Process -FilePath 'powershell.exe' ` +
    `-ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', '${encodedScript}') ` +
    `-WorkingDirectory ${quote(cwd)} ` +
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
  return { success: true, pid: wrapperPid }
}

// Orchestration. Returns:
//   { success: true, pid, cleanup }   — pid is the PS wrapper; cleanup() releases
//                                       any worktrees and removes Directory.Build.props
//   { success: false, error }
async function launchBinary(instance) {
  const spec = buildBinarySpawn(instance)
  if (process.platform !== 'win32') {
    // Non-Windows placeholder — not the path real users hit, but keeps the
    // shape testable.
    const child = spawn(spec.command, spec.args, {
      env: { ...process.env, ...spec.env },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child.unref()
    return { success: true, pid: child.pid, cleanup: async () => {} }
  }
  const result = await spawnInPowerShellConsole({
    command: spec.command,
    args: spec.args,
    env: spec.env,
    cwd: instance.dataDir
  })
  if (!result.success) return result
  return { success: true, pid: result.pid, cleanup: async () => {} }
}

async function launchRepo(instance) {
  // 1. Resolve the server worktree (or use checkout in place if branch is null).
  let serverWorktreePath
  let releaseServer = async () => {}
  if (instance.serverBranch) {
    serverWorktreePath = await ensureWorktree(instance.serverRepoPath, instance.serverBranch)
    releaseServer = () => releaseWorktree(instance.serverRepoPath, instance.serverBranch)
  } else {
    serverWorktreePath = instance.serverRepoPath
  }

  // 2. If user opted into a local XML branch, ensure that worktree, sniff
  //    the server csproj, and write the Directory.Build.props redirect.
  let releaseXml = async () => {}
  let didWriteBuildProps = false
  try {
    if (instance.xmlBranch) {
      if (!(await csprojSupportsLocalXml(serverWorktreePath))) {
        await releaseServer()
        return {
          success: false,
          error:
            'This server branch lacks the UseLocalXml conditional ' +
            '(needs server commit 11bc748 or later on hybrasyl/Hybrasyl.csproj). ' +
            'Update the server branch, or unset the XML branch on this instance.'
        }
      }
      const xmlWorktreePath = await ensureWorktree(instance.xmlRepoPath, instance.xmlBranch)
      releaseXml = () => releaseWorktree(instance.xmlRepoPath, instance.xmlBranch)
      const xmlCsproj = join(xmlWorktreePath, 'src', 'Hybrasyl.Xml.csproj')
      await writeBuildProps(serverWorktreePath, xmlCsproj)
      didWriteBuildProps = true
    }

    // 3. Spawn via the same PowerShell wrapper as binary mode.
    const spec = buildRepoSpawn(instance, serverWorktreePath)
    if (process.platform !== 'win32') {
      const child = spawn(spec.command, spec.args, {
        cwd: serverWorktreePath,
        env: { ...process.env, ...spec.env },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      child.unref()
      return {
        success: true,
        pid: child.pid,
        cleanup: async () => {
          if (didWriteBuildProps) await removeBuildProps(serverWorktreePath)
          await releaseXml()
          await releaseServer()
        }
      }
    }
    const result = await spawnInPowerShellConsole({
      command: spec.command,
      args: spec.args,
      env: spec.env,
      cwd: serverWorktreePath
    })
    if (!result.success) {
      // Spawn failed — undo what we set up so the next attempt is clean.
      if (didWriteBuildProps) await removeBuildProps(serverWorktreePath)
      await releaseXml()
      await releaseServer()
      return result
    }
    return {
      success: true,
      pid: result.pid,
      cleanup: async () => {
        if (didWriteBuildProps) await removeBuildProps(serverWorktreePath)
        await releaseXml()
        await releaseServer()
      }
    }
  } catch (err) {
    // Any setup step (worktree add, build-props write) blew up — undo and report.
    try { if (didWriteBuildProps) await removeBuildProps(serverWorktreePath) } catch {}
    try { await releaseXml() } catch {}
    try { await releaseServer() } catch {}
    return { success: false, error: `Failed to set up repo-mode launch: ${err.message}` }
  }
}

export async function launch(instance) {
  const valid = validateForLaunch(instance)
  if (!valid.ok) return { success: false, error: valid.error }

  const redisTarget = await resolveRedisTarget(instance)
  if (redisTarget) {
    const redis = await redisCheck(redisTarget.host, redisTarget.port)
    if (!redis.ok) {
      const isLoopback =
        redisTarget.host === 'localhost' ||
        redisTarget.host === '127.0.0.1' ||
        redisTarget.host === '::1'
      const wslHint = isLoopback
        ? ` WSL tip: try \`wsl --shutdown\` then restart Redis, or install Memurai ` +
          `(\`winget install Memurai.MemuraiDeveloper\`) for native Windows Redis.`
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

  // Pre-flight: fail fast if the lobby port is already occupied.
  const portInUse = await redisCheck('127.0.0.1', instance.lobbyPort, 500)
  if (portInUse.ok) {
    return {
      success: false,
      error:
        `Port ${instance.lobbyPort} is already in use — probably a leftover server ` +
        `from an earlier launch. Stop it (or kill dotnet.exe in Task Manager) and retry.`
    }
  }

  return instance.mode === 'repo' ? launchRepo(instance) : launchBinary(instance)
}
