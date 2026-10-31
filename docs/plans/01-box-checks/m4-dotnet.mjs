// HTOO-627 machine check M4 (HTOO-645), macOS: the hinted .NET install, `brew install dotnet`.
//
// Run it the way Finder starts Epona: no shell profile, launchd's PATH, no DOTNET_ROOT.
//
//   env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/sbin:/sbin \
//     /opt/homebrew/bin/node docs/plans/01-box-checks/m4-dotnet.mjs <framework-dependent apphost>
//
// The apphost is any `dotnet publish -r osx-arm64 --self-contained false` output; Brigid's
// releases are self-contained, so they cannot show the fault. Build it before the swap.
// Environment: SERVER_REPO, WORLD_DIR, LOG_DIR, CONFIG, LOBBY_PORT as in lifecycle.mjs.
// Each step prints PASS or FAIL against the fixed behaviour; the script exits 1 on a FAIL.
import { spawn, execFileSync } from 'child_process'
import { realpathSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const EPONA = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const SRC = join(EPONA, 'src/main')
const SERVER_REPO = resolve(process.env.SERVER_REPO ?? join(EPONA, '../server'))
const WORLD_DIR = resolve(process.env.WORLD_DIR ?? join(EPONA, '../world'))
const LOG_DIR = resolve(process.env.LOG_DIR ?? join(WORLD_DIR, 'logs'))
const CONFIG = process.env.CONFIG ?? 'local.xml'
const PORT = Number(process.env.LOBBY_PORT ?? 2610)
const APPHOST = process.argv[2]

const { resolveDotnetPath } = await import(join(SRC, 'dotnet.js'))
const { checkDotnetRuntime } = await import(join(SRC, 'runtimeCheck.js'))
const { resolvePath, buildSpawnArgs } = await import(join(SRC, 'targets/hybrasylTarget.js'))
const { buildRepoSpawn } = await import(join(SRC, 'targets/serverTarget.js'))
const { isPortInUse } = await import(join(SRC, 'portProbe.js'))

const failures = []
const verdict = (check, pass, detail) => {
  if (!pass) failures.push(check)
  console.log(`${check} ${pass ? 'PASS' : 'FAIL'}: ${detail}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const run = (command, args, env) =>
  new Promise((done) => {
    let out = ''
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (c) => (out += c))
    child.stderr.on('data', (c) => (out += c))
    child.once('error', (err) => done({ code: null, out: String(err) }))
    child.once('exit', (code) => done({ code, out: out.trim() }))
  })

console.log(`PATH=${process.env.PATH}  DOTNET_ROOT=${process.env.DOTNET_ROOT ?? '(unset)'}`)
if (process.env.DOTNET_ROOT) console.log('warning: DOTNET_ROOT is set; run under env -i as above')

// 1. Discovery and the runtime chip.
const dotnet = await resolveDotnetPath()
const rt = await checkDotnetRuntime()
verdict(
  'M4.1 runtime chip',
  rt.dotnetFound && rt.netCoreApp10 && rt.sdk10,
  `resolveDotnetPath() = ${dotnet}; runtime 10: ${rt.netCoreApp10}, SDK 10: ${rt.sdk10}`
)

// 2. A binary-mode client apphost, spawned as hybrasylTarget does (no DOTNET_ROOT added).
if (APPHOST) {
  const resolved = await resolvePath(APPHOST)
  const { command, args } = buildSpawnArgs(resolved, 'dotnet')
  const r = await run(command, args, { ...process.env, DA_NO_LAUNCHER: '1' })
  verdict(
    'M4.2 binary-mode apphost',
    r.code === 0,
    `kind ${resolved.kind}; exit ${r.code}: ${r.out.split('\n')[0].slice(0, 140)}`
  )

  // The two DOTNET_ROOT values a fix could set: the card's dirname(realpath(dotnet)),
  // and the root that `dotnet --list-runtimes` reports.
  const fromRealpath = dirname(realpathSync(dotnet))
  const listed = execFileSync(dotnet, ['--list-runtimes'], { encoding: 'utf8' })
  const m = listed.match(/Microsoft\.NETCore\.App 10\.\S+ \[(.+)\]/)
  const fromList = m ? resolve(m[1], '../..') : null
  for (const [label, root] of [
    ['dirname(realpath(dotnet))', fromRealpath],
    ['--list-runtimes root', fromList]
  ]) {
    const r2 = await run(command, args, { ...process.env, DA_NO_LAUNCHER: '1', DOTNET_ROOT: root })
    console.log(`  fix candidate ${label} = ${root}: exit ${r2.code}`)
  }
} else {
  console.log('M4.2 skipped: pass a framework-dependent apphost as the first argument')
}

// 3. The repo-mode server, spawned as spawnDirect does.
if (await isPortInUse('127.0.0.1', PORT, 500)) {
  console.log(`M4.3 skipped: port ${PORT} is in use`)
} else {
  const instance = { dataDir: WORLD_DIR, logDir: LOG_DIR, configFileName: CONFIG, redisHost: '' }
  const spec = buildRepoSpawn(instance, SERVER_REPO, dotnet)
  let tail = ''
  const child = spawn(spec.command, spec.args, {
    cwd: SERVER_REPO,
    env: { ...process.env, ...spec.env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const keep = (c) => (tail = (tail + c).slice(-600))
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  let exited = null
  child.once('exit', (code) => (exited = code))
  const t0 = Date.now()
  let up = false
  while (!up && exited === null && Date.now() - t0 < 600000) {
    await sleep(2000)
    up = await isPortInUse('127.0.0.1', PORT, 500)
  }
  verdict(
    'M4.3 repo-mode server',
    up,
    up
      ? `listening after ${Math.round((Date.now() - t0) / 1000)} s`
      : `exit ${exited}: ${tail.replace(/\s+/g, ' ').slice(-240)}`
  )
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    /* gone */
  }
  await sleep(1500)
}

console.log(`\nSUMMARY: ${failures.length ? `FAIL (${failures.join(', ')})` : 'PASS'}`)
process.exit(failures.length ? 1 : 0)
