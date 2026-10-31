// HTOO-627 machine checks M1/L1 (HTOO-642) and M3/L1 (HTOO-592), on macOS or Linux.
//
// Drives Epona's own main-process modules against a real repo-mode server, spawned
// exactly as serverTarget's spawnDirect does. Read-only for every repo: it starts the
// server in place, stops it, and leaves nothing running. The server writes its usual
// logs into the log folder.
//
//   node docs/plans/01-box-checks/lifecycle.mjs
//
// Environment (defaults assume the server and world checkouts beside epona):
//   SERVER_REPO   ../server         WORLD_DIR    ../world
//   LOG_DIR       $WORLD_DIR/logs   CONFIG       local.xml   (a config whose Name matches, HTOO-595)
//   LOBBY_PORT    2610
// Needs Redis on localhost and the server's ports free.
//
// Each check prints PASS or FAIL against the behaviour the fix must have, and the
// script exits 1 on any FAIL. On `main` at a1a2d16 (before the fixes): M1 FAIL, M3
// PASS on macOS. Each step calls what Epona's Stop calls today; if the HTOO-642 or
// HTOO-592 fix changes those calls, change the step to match.
import { spawn, execFileSync } from 'child_process'
import { createWriteStream } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const EPONA = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const SRC = join(EPONA, 'src/main')
const SERVER_REPO = resolve(process.env.SERVER_REPO ?? join(EPONA, '../server'))
const WORLD_DIR = resolve(process.env.WORLD_DIR ?? join(EPONA, '../world'))
const LOG_DIR = resolve(process.env.LOG_DIR ?? join(WORLD_DIR, 'logs'))
const CONFIG = process.env.CONFIG ?? 'local.xml'
const PORT = Number(process.env.LOBBY_PORT ?? 2610)

const { buildRepoSpawn } = await import(join(SRC, 'targets/serverTarget.js'))
const { killProcessTree } = await import(join(SRC, 'processKill.js'))
const { findPortOwner } = await import(join(SRC, 'portOwner.js'))
const { raceChildExit } = await import(join(SRC, 'instanceManager.js'))
const { isPortInUse } = await import(join(SRC, 'portProbe.js'))
const { resolveDotnetPath } = await import(join(SRC, 'dotnet.js'))

const outFile = join(process.env.OUT_DIR ?? '.', 'box-checks-server-output.log')
const serverLog = createWriteStream(outFile)
const instance = { dataDir: WORLD_DIR, logDir: LOG_DIR, configFileName: CONFIG, redisHost: '' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const failures = []
const verdict = (check, card, pass, detail) => {
  if (!pass) failures.push(check)
  say(`${check} ${pass ? 'PASS' : 'FAIL'} (${card}): ${detail}`)
}
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const psLines = (args, keep = () => true) => {
  try {
    return (
      execFileSync('ps', args, { encoding: 'utf8' })
        .split('\n')
        .filter((l) => l.trim() && keep(l))
        .map((l) => l.slice(0, 160))
        .join('\n') || '(none)'
    )
  } catch {
    return '(none)'
  }
}

async function launch(label) {
  const spec = buildRepoSpawn(instance, SERVER_REPO, await resolveDotnetPath())
  say(label, 'spawn:', spec.command, spec.args.join(' '))
  const child = spawn(spec.command, spec.args, {
    cwd: SERVER_REPO,
    env: { ...process.env, ...spec.env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', (c) => serverLog.write(c))
  child.stderr.on('data', (c) => serverLog.write(c))
  let exited = null
  child.once('exit', (code, sig) => {
    exited = { code, sig }
  })
  const t0 = Date.now()
  while (!(await isPortInUse('127.0.0.1', PORT, 500))) {
    if (exited)
      throw new Error(
        `${label}: server exited before listening (${JSON.stringify(exited)}); see ${outFile}`
      )
    if (Date.now() - t0 > 600000)
      throw new Error(`${label}: nothing listening on ${PORT} after 10 min`)
    await sleep(2000)
  }
  say(
    label,
    `listening on ${PORT} after ${Math.round((Date.now() - t0) / 1000)} s; dotnet run pid ${child.pid}`
  )
  await sleep(3000)
  return { child, getExit: () => exited }
}

async function hardStop(child) {
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    /* gone */
  }
  const owner = await findPortOwner(PORT)
  if (owner) {
    try {
      process.kill(owner, 'SIGKILL')
    } catch {
      /* gone */
    }
  }
  await sleep(1500)
}

if (await isPortInUse('127.0.0.1', PORT, 500)) {
  console.error(`port ${PORT} is already in use; stop that server first`)
  process.exit(2)
}

// M1 / L1 — the adopted Stop: findPortOwner → killProcessTree, as stopAdoptedInstance does.
{
  const { child } = await launch('M1')
  const owner = await findPortOwner(PORT)
  say(`M1 findPortOwner = ${owner}; dotnet run pid = ${child.pid}`)
  say(
    'M1 pid ppid pgid command:\n' +
      psLines(['-o', 'pid=,ppid=,pgid=,command=', '-p', `${owner},${child.pid}`])
  )
  say(
    `M1 group ${child.pid}:\n` +
      psLines(
        ['-axo', 'pid=,ppid=,pgid=,command='],
        (l) => l.trim().split(/\s+/)[2] === String(child.pid)
      )
  )
  say('M1 killProcessTree(owner) =', JSON.stringify(await killProcessTree(owner)))
  await sleep(3000)
  const still = await isPortInUse('127.0.0.1', PORT, 500)
  verdict(
    'M1',
    'HTOO-642',
    !still && !alive(owner),
    `after the adopted Stop the port is ${still ? 'still listening' : 'free'}, listener ${alive(owner) ? 'alive' : 'gone'}`
  )
  await hardStop(child)
}

// M3 / L1 — the tracked Stop: raceChildExit (SIGTERM to dotnet run, 5 s), as instance:stop does.
{
  const { child, getExit } = await launch('M3')
  const owner = await findPortOwner(PORT)
  const t0 = Date.now()
  await raceChildExit(child, 5000)
  say(
    `M3 raceChildExit returned after ${Date.now() - t0} ms; dotnet run exit:`,
    JSON.stringify(getExit())
  )
  let freeAfter = null
  for (let i = 0; i < 15 && freeAfter === null; i++) {
    await sleep(1000)
    if (!(await isPortInUse('127.0.0.1', PORT, 500))) freeAfter = Date.now() - t0
  }
  verdict(
    'M3',
    'HTOO-592',
    !alive(owner) && freeAfter !== null && freeAfter <= 5000,
    `listener ${alive(owner) ? 'alive' : 'gone'}; port ${freeAfter === null ? 'still listening 15 s after Stop' : `free ${Math.round(freeAfter / 1000)} s after Stop`} (must be free within Stop's 5 s)`
  )
  await hardStop(child)
}
say(`done; server output is in ${outFile}`)
console.log(`\nSUMMARY: ${failures.length ? `FAIL (${failures.join(', ')})` : 'PASS'}`)
process.exit(failures.length ? 1 : 0)
