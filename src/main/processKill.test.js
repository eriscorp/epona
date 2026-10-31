import { describe, it, expect, afterEach } from 'vitest'
import { spawn } from 'child_process'
import { killProcessTree } from './processKill.js'

// An absurdly large pid that cannot exist. On POSIX, process.kill(-pid) throws
// ESRCH; on Windows, taskkill exits non-zero ("process not found"). Both are
// harmless to run for real (nothing is actually killed), matching the project's
// real-subprocess test style (gitOps spawns real git, redisProbe real sockets).
const BOGUS_PID = 999999999

describe('killProcessTree', () => {
  it.skipIf(process.platform === 'win32')(
    'treats ESRCH (already-dead pgid) as success on POSIX',
    async () => {
      // process.kill(-pid) throws ESRCH which the helper should map to ok:true.
      const result = await killProcessTree(BOGUS_PID)
      expect(result).toEqual({ ok: true })
    }
  )

  it.runIf(process.platform === 'win32')(
    'resolves ok on Windows even when taskkill finds no such process',
    async () => {
      // killWindowsTree spawns real taskkill /F /T /PID and resolves ok:true on
      // any exit (it doesn't inspect the exit code), so a bogus pid still ok's.
      const result = await killProcessTree(BOGUS_PID)
      expect(result).toEqual({ ok: true })
    }
  )
})

// Real process groups, on the ubuntu and macos legs of CI (unit-posix). Each
// test spawns `sh` or `sleep` and checks what is left running.
describe.skipIf(process.platform === 'win32')('killProcessTree on POSIX', () => {
  const spawned = []

  afterEach(() => {
    // A failed test must not leave a sleep behind.
    for (const { pid, group } of spawned.splice(0)) {
      try {
        process.kill(group ? -pid : pid, 'SIGKILL')
      } catch {
        /* gone */
      }
    }
  })

  function start(command, args, { detached = true } = {}) {
    const child = spawn(command, args, { detached, stdio: ['ignore', 'pipe', 'ignore'] })
    spawned.push({ pid: child.pid, group: detached })
    const exit = new Promise((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal }))
    )
    // The first line the child prints.
    const firstLine = new Promise((resolve) => {
      let buf = ''
      child.stdout.on('data', (chunk) => {
        buf += chunk
        if (buf.includes('\n')) resolve(buf.split('\n')[0].trim())
      })
    })
    return { child, exit, firstLine }
  }

  const alive = (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  it('ends the whole group from a PID that does not lead it (HTOO-642)', async () => {
    // The adopted Stop's case: lsof names the server apphost, a child in the
    // group that `dotnet run` leads. Here `sh` leads the group and the `sleep`
    // is the listener. Signalling `-<sleep pid>` found no group, failed with
    // ESRCH, and reported success with both still running.
    const { child, exit, firstLine } = start('sh', ['-c', 'sleep 60 & echo $!; wait'])
    const listener = Number(await firstLine)
    expect(listener).not.toBe(child.pid)

    const result = await killProcessTree(listener, { graceMs: 2000 })

    expect(result).toEqual({ ok: true })
    expect(alive(listener)).toBe(false)
    await expect(exit).resolves.toMatchObject({ signal: 'SIGTERM' })
  })

  it('sends SIGTERM first, so a server can shut down (HTOO-592)', async () => {
    const { child, exit } = start('sleep', ['60'])

    await expect(killProcessTree(child.pid)).resolves.toEqual({ ok: true })

    await expect(exit).resolves.toEqual({ code: null, signal: 'SIGTERM' })
  })

  it('sends SIGKILL to a group that outlives the grace period (HTOO-592)', async () => {
    // `trap '' TERM` ignores SIGTERM, and the `sleep` inherits that.
    const { child, exit, firstLine } = start('sh', ['-c', "trap '' TERM; echo ready; sleep 60"])
    await firstLine
    const started = Date.now()

    const result = await killProcessTree(child.pid, { graceMs: 300 })

    expect(result).toEqual({ ok: true })
    expect(Date.now() - started).toBeGreaterThanOrEqual(300)
    await expect(exit).resolves.toMatchObject({ signal: 'SIGKILL' })
  })

  it('signals only the PID of a child that shares its own process group', async () => {
    // A child spawned without `detached` is in this process's group. A signal to
    // the group would end the test runner too.
    const { child, exit } = start('sleep', ['60'], { detached: false })

    await expect(killProcessTree(child.pid)).resolves.toEqual({ ok: true })

    await expect(exit).resolves.toEqual({ code: null, signal: 'SIGTERM' })
  })
})
