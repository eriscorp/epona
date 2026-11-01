import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { check as redisCheck } from '../redisProbe.js'
import { isPortInUse } from '../portProbe.js'
import { readDataStore } from '../serverConfigs.js'
import { ensureWorktree, releaseWorktree } from '../worktreeManager.js'
import {
  writeBuildProps,
  removeBuildProps,
  claimBuildProps,
  releaseBuildProps
} from '../buildProps.js'
import { resolveDotnetPath } from '../dotnet.js'
import { spawnStarted, describeSpawnError } from './spawnStarted.js'

// The server config the user picked, as a path for `--configFile`. `--config`
// takes a config's Name attribute, not its file name, and matches it with case:
// `config.xml` with no Name is "default", and `local.xml` with Name="Local" is
// "Local", so the file name failed to start both (HTOO-595). `--configFile`
// loads the one file. The server has had it since the same commit as the
// camelCase flags (`9b169383`), so every server that takes `--logDir` takes it.
export function serverConfigPath(instance) {
  return join(instance.dataDir, 'xml', 'serverconfigs', instance.configFileName)
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
// --dataDir. --worldDataDir is then `<dataDir>/xml`. --configFile takes the
// picked file under <worldDataDir>/serverconfigs/ (serverConfigPath).
function buildServerArgs(instance) {
  return [
    '--dataDir',
    instance.dataDir,
    '--worldDataDir',
    join(instance.dataDir, 'xml'),
    '--logDir',
    instance.logDir,
    '--configFile',
    serverConfigPath(instance)
  ]
}

// Pure: build the { command, args, env } the server should be spawned with
// for a binary-mode instance. A built .dll runs as `dotnet <dll>`. Anything
// else runs directly: a .exe on Windows, or the apphost with no extension that
// `dotnet publish` makes for macOS and Linux. That apphost ran as
// `dotnet <apphost>`, which fails (F10 in HTOO-627).
export function buildBinarySpawn(instance, dotnetPath = 'dotnet') {
  const env = buildEnv(instance)
  const args = buildServerArgs(instance)
  if (!/\.dll$/i.test(instance.binaryPath)) return { command: instance.binaryPath, args, env }
  return { command: dotnetPath, args: [instance.binaryPath, ...args], env }
}

// What to tell the user about a server left over from an earlier launch: the
// tool for this OS (HTOO-596).
export function leftoverServerHint(platform = process.platform) {
  if (platform === 'win32') return 'Stop it (or end dotnet.exe in Task Manager) and retry.'
  if (platform === 'darwin') return 'Stop it (or quit dotnet in Activity Monitor) and retry.'
  return 'Stop it (or end its dotnet process with `kill`) and retry.'
}

// Pure: build the { command, args, env } for a repo-mode instance. Always
// `dotnet run --project <serverWorktree>/hybrasyl/Hybrasyl.csproj -- <server args>`.
// `--no-launch-profile` skips Properties/launchSettings.json (we control env
// via the explicit env block). `--configuration Debug` matches what a
// developer would do interactively.
export function buildRepoSpawn(instance, serverWorktreePath, dotnetPath = 'dotnet') {
  const env = buildEnv(instance)
  const csproj = join(serverWorktreePath, 'hybrasyl', 'Hybrasyl.csproj')
  return {
    command: dotnetPath,
    args: [
      'run',
      '--project',
      csproj,
      '--configuration',
      'Debug',
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

// Name an instance's XML selection the way the user set it. An empty string is
// the "use the XML repo in place" option rather than a branch, and calling that
// a branch in an error message sends the reader looking for one. null is no
// local XML: the build uses the published package.
export function describeXmlBranch(xmlBranch) {
  if (xmlBranch === null) return 'the published Hybrasyl.Xml package'
  return xmlBranch ? `XML branch "${xmlBranch}"` : 'the XML checkout in place'
}

// The refusal when another running instance holds this server worktree's
// Directory.Build.props for a different XML. `wanted` is this instance's
// label, as describeXmlBranch takes it.
function buildPropsConflict(conflict, wanted) {
  return {
    success: false,
    error:
      `Another running instance already points this server worktree at ` +
      `${describeXmlBranch(conflict.xmlBranchLabel)}, and this one needs ` +
      `${describeXmlBranch(wanted)}. They share one ` +
      `Directory.Build.props because they share a server branch. Stop the ` +
      `other instance, or put both on the same XML branch.`
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
    // A Windows program cannot run here (HTOO-596).
    if (process.platform !== 'win32' && /\.exe$/i.test(instance.binaryPath)) {
      return {
        ok: false,
        error:
          'The server binary is a Windows program. Pick Hybrasyl.dll, or the macOS or Linux build of the server.'
      }
    }
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

// The file that the Windows console script copies the server's output to, in
// the instance's log folder, for the Log Pane (HTOO-652). One per instance, so
// two instances that share a log folder do not share it.
export function consoleLogPath(instance) {
  return join(instance.logDir, `epona-console-${String(instance.id).replace(/[^\w.-]/g, '_')}.log`)
}

// The script that runs in the server's console window. It shows each output
// line in the window and writes it to `logFile`, which Epona follows into the
// Log Pane (HTOO-652). Stdin is not piped, so the server still has the console
// for its input. It pauses on Read-Host after the exit so crash traces do not
// vanish, and it writes the exit code to the file too.
//
// Not Tee-Object: in Windows PowerShell 5.1 it writes UTF-16, and with `2>&1`
// PowerShell prints each stderr line as an error record. ForEach-Object writes
// the line's own text, and the StreamWriter writes UTF-8 with no BOM.
// [Console]::OutputEncoding is UTF-8 so that the server writes UTF-8 to the
// pipe, and PowerShell reads it as UTF-8.
//
// Ctrl+C in the window stops the server and this script too, so the last line
// goes in a `finally`, which PowerShell runs when it stops a script. Without it
// a Ctrl+C left the pane with no end. The window then closes, because the
// stopped script does not reach Read-Host.
export function buildConsoleScript({ command, args, logFile }) {
  const quote = (s) => `'${String(s).replace(/'/g, "''")}'`
  return (
    `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ` +
    `$log = New-Object System.IO.StreamWriter(${quote(logFile)}, $false, (New-Object System.Text.UTF8Encoding $false)); ` +
    `$log.AutoFlush = $true; ` +
    `$code = $null; ` +
    `try { ` +
    `& ${quote(command)} ${args.map(quote).join(' ')} 2>&1 | ForEach-Object { $line = "$_"; [Console]::WriteLine($line); $log.WriteLine($line) }; ` +
    `$code = $LASTEXITCODE ` +
    `} finally { ` +
    `if ($null -eq $code) { $log.WriteLine('[epona] The server was stopped from its console window.') } ` +
    `else { $log.WriteLine('[epona] The server exited with code ' + $code + '.') }; ` +
    `$log.Close() ` +
    `}; ` +
    `Write-Host ''; ` +
    `Write-Host ('=== Server exited (code ' + $code + '). Press Enter to close this window. ===') -ForegroundColor Yellow; ` +
    `$null = Read-Host`
  )
}

// Spawn `command args` inside a new visible PowerShell console window (see
// buildConsoleScript). Returns { success, pid, logFile } where pid is the
// wrapper PID (taskkill /F /T against it reaps the whole tree). Used by both
// binary and repo modes.
async function spawnInPowerShellConsole({ command, args, env, cwd, logFile }) {
  const quote = (s) => `'${String(s).replace(/'/g, "''")}'`

  // Empty it first, so that the Log Pane does not show the last run while the
  // console window starts.
  await fs.writeFile(logFile, '')
  const childScript = buildConsoleScript({ command, args, logFile })
  const encodedScript = Buffer.from(childScript, 'utf16le').toString('base64')

  const outerPs =
    `$ErrorActionPreference='Stop'; ` +
    `$p = Start-Process -FilePath 'powershell.exe' ` +
    `-ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', '${encodedScript}') ` +
    `-WorkingDirectory ${quote(cwd)} ` +
    `-WindowStyle Normal -PassThru; ` +
    `Write-Output $p.Id`

  const shim = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', outerPs],
    {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    }
  )

  let psStdout = ''
  let psStderr = ''
  shim.stdout.on('data', (c) => {
    psStdout += c.toString()
  })
  shim.stderr.on('data', (c) => {
    psStderr += c.toString()
  })
  const exitCode = await new Promise((resolve) => {
    shim.once('exit', (code) => resolve(code))
    shim.once('error', () => resolve(-1))
    setTimeout(() => resolve(null), 5000)
  })
  if (exitCode === null) {
    try {
      shim.kill()
    } catch {
      /* already dead */
    }
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
  return { success: true, pid: wrapperPid, logFile }
}

// Non-Windows direct spawn: no PowerShell wrapper — spawn the server directly
// and let the renderer's log panel surface its output via wireInstanceLogs.
// detached:true puts the child in its own process group so killProcessTree can
// SIGKILL the whole tree by negated pid. Shared by binary + repo modes.
//
// It reports success only once the program runs, and undoes the launch's setup
// when it does not. A synchronous throw rejected the IPC call, and the Start
// button stayed on "Starting…" (HTOO-594).
async function spawnDirect(spec, cwd, cleanup) {
  let failed
  let child
  try {
    child = spawn(spec.command, spec.args, {
      cwd,
      env: { ...process.env, ...spec.env },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    failed = await spawnStarted(child)
  } catch (err) {
    failed = err
  }
  if (failed) {
    await cleanup()
    return { success: false, error: `Failed to start the server: ${describeSpawnError(failed)}` }
  }
  return { success: true, child, cleanup }
}

// Orchestration. Returns:
//   { success: true, pid, cleanup }   — pid is the PS wrapper; cleanup() releases
//                                       any worktrees and removes Directory.Build.props
//   { success: false, error }
async function launchBinary(instance) {
  const spec = buildBinarySpawn(instance, await resolveDotnetPath())
  if (process.platform !== 'win32') {
    return spawnDirect(spec, instance.dataDir, async () => {})
  }
  const result = await spawnInPowerShellConsole({
    command: spec.command,
    args: spec.args,
    env: spec.env,
    cwd: instance.dataDir,
    logFile: consoleLogPath(instance)
  })
  if (!result.success) return result
  return { success: true, pid: result.pid, logFile: result.logFile, cleanup: async () => {} }
}

async function launchRepo(instance) {
  // 1. Resolve the server worktree. Skip the worktree dance when serverNoGit
  //    is set (git isn't available, or the picked folder isn't a working tree)
  //    or when no branch is pinned — both cases launch in place from the
  //    picked repo path.
  let serverWorktreePath
  let releaseServer = async () => {}
  const onBranchWorktree = Boolean(instance.serverBranch && !instance.serverNoGit)
  if (onBranchWorktree) {
    serverWorktreePath = await ensureWorktree(instance.serverRepoPath, instance.serverBranch)
    releaseServer = () => releaseWorktree(instance.serverRepoPath, instance.serverBranch)
  } else {
    serverWorktreePath = instance.serverRepoPath
  }

  // 2. If user opted into a local XML branch, ensure that worktree, sniff
  //    the server csproj, and write the Directory.Build.props redirect.
  //    Under xmlNoGit, skip the worktree but still write build-props pointing
  //    at the picked XML repo's csproj — local-XML override stays functional.
  let releaseXml = async () => {}
  let didClaimBuildProps = false
  let didWriteBuildProps = false
  // Single teardown for every exit path — undo build-props, then release the
  // XML worktree, then the server worktree. Reads the mutable vars at call time
  // so it reflects whatever setup completed before it runs. Each step swallows
  // its own error so one failing step can't strand the others, and so the catch
  // and spawn-failure paths can both just `await cleanup()`.
  const cleanup = async () => {
    try {
      // Release the claim whenever we took one, even if the write that was
      // meant to follow it never happened — a claim held by a launch that
      // failed would block the next launch on a different XML branch for the
      // rest of the session.
      //
      // Only the LAST claimant removes the file. Two instances sharing a
      // worktree and the same XML branch both wrote it; if the first to stop
      // deleted it, the one still running would fall back to the NuGet
      // package on its next build. See HTOO-89.
      if (didClaimBuildProps) {
        const { last } = releaseBuildProps(serverWorktreePath, instance.id)
        if (didWriteBuildProps && last) await removeBuildProps(serverWorktreePath)
      }
    } catch {
      /* best effort */
    }
    try {
      await releaseXml()
    } catch {
      /* best effort */
    }
    try {
      await releaseServer()
    } catch {
      /* best effort */
    }
  }
  try {
    // xmlBranch !== null means "use local XML" (either '' = in-place or a
    // branch name). Combined with xmlNoGit, force the in-place semantic.
    const useLocalXml = instance.xmlBranch !== null && instance.xmlRepoPath
    if (useLocalXml) {
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
      let xmlWorktreePath = instance.xmlRepoPath
      if (instance.xmlBranch && !instance.xmlNoGit) {
        xmlWorktreePath = await ensureWorktree(instance.xmlRepoPath, instance.xmlBranch)
        releaseXml = () => releaseWorktree(instance.xmlRepoPath, instance.xmlBranch)
      }
      const xmlCsproj = join(xmlWorktreePath, 'src', 'Hybrasyl.Xml.csproj')
      // Directory.Build.props is keyed by the server worktree alone, and two
      // instances on one server branch share that worktree. Refuse rather than
      // overwrite: the instance already running would keep its process but
      // start building against the other one's XML at its next dotnet
      // invocation, with nothing reported anywhere. See HTOO-89.
      const claim = claimBuildProps(serverWorktreePath, xmlCsproj, instance.id, instance.xmlBranch)
      if (!claim.ok) {
        await releaseXml()
        await releaseServer()
        return buildPropsConflict(claim.conflict, instance.xmlBranch)
      }
      didClaimBuildProps = true
      await writeBuildProps(serverWorktreePath, xmlCsproj)
      didWriteBuildProps = true
    } else if (onBranchWorktree) {
      // No local XML, in a worktree Epona made: write the file that sets
      // nothing, or MSBuild imports the repo root's (HTOO-646). Claimed like a
      // redirect, so that a second instance on this branch cannot point the
      // worktree at a local XML while this one runs. An in-place launch builds
      // the user's own checkout, and its root file is theirs to keep.
      const claim = claimBuildProps(serverWorktreePath, null, instance.id, null)
      if (!claim.ok) {
        await releaseServer()
        return buildPropsConflict(claim.conflict, null)
      }
      didClaimBuildProps = true
      await writeBuildProps(serverWorktreePath, null)
      didWriteBuildProps = true
    }

    // 3. Spawn via the same PowerShell wrapper as binary mode (Windows only).
    //    On non-Windows, spawn directly and let wireInstanceLogs surface output.
    const spec = buildRepoSpawn(instance, serverWorktreePath, await resolveDotnetPath())
    if (process.platform !== 'win32') {
      return spawnDirect(spec, serverWorktreePath, cleanup)
    }
    const result = await spawnInPowerShellConsole({
      command: spec.command,
      args: spec.args,
      env: spec.env,
      cwd: serverWorktreePath,
      logFile: consoleLogPath(instance)
    })
    if (!result.success) {
      // Spawn failed — undo what we set up so the next attempt is clean.
      await cleanup()
      return result
    }
    return { success: true, pid: result.pid, logFile: result.logFile, cleanup }
  } catch (err) {
    // Any setup step (worktree add, build-props write) blew up — undo and
    // report. cleanup() already swallows each step's errors during recovery.
    await cleanup()
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
      // Platform-specific "how to fix" hint — Memurai/WSL only make sense on
      // Windows; macOS/Linux get the native Redis install line.
      let hint
      if (!isLoopback) {
        hint = ' Point the instance at a reachable Redis.'
      } else if (process.platform === 'win32') {
        hint =
          ' Start Memurai/Valkey, or for WSL Redis try `wsl --shutdown` then restart it.' +
          ' Install Memurai with `winget install Memurai.MemuraiDeveloper` for native Windows Redis.'
      } else if (process.platform === 'darwin') {
        hint = ' Start Redis locally (e.g. `brew install redis` then `brew services start redis`).'
      } else {
        hint = ' Start Redis locally (e.g. `sudo apt install redis-server`).'
      }
      return {
        success: false,
        error:
          `Redis unreachable at ${redisTarget.host}:${redisTarget.port} ` +
          `(${redis.error}; from ${redisTarget.source}).` +
          hint
      }
    }
  }

  // Pre-flight: fail fast if the lobby port is already occupied. Pure TCP
  // probe — a RESP-PING based probe gives false negatives when the existing
  // listener (e.g. a leftover Hybrasyl server) doesn't speak Redis.
  if (await isPortInUse('127.0.0.1', instance.lobbyPort, 500)) {
    return {
      success: false,
      error:
        `Port ${instance.lobbyPort} is already in use — probably a leftover server ` +
        `from an earlier launch. ${leftoverServerHint()}`
    }
  }

  // The server refuses a log folder that does not exist: it prints one stderr
  // line above its usage text and exits, in repo mode after a full build
  // (HTOO-587). Make the folder, as the client's log auto-save does.
  try {
    await fs.mkdir(instance.logDir, { recursive: true })
  } catch (err) {
    return {
      success: false,
      error: `Could not create the log folder ${instance.logDir}: ${err.message}`
    }
  }

  return instance.mode === 'repo' ? launchRepo(instance) : launchBinary(instance)
}
