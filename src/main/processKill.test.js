import { describe, it, expect } from 'vitest'
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
