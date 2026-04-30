import { describe, it, expect } from 'vitest'
import { killProcessTree } from './processKill.js'

describe('killProcessTree', () => {
  it.skipIf(process.platform === 'win32')(
    'treats ESRCH (already-dead pgid) as success on POSIX',
    async () => {
      // 999999999 is an absurdly large pid that cannot exist; process.kill(-pid)
      // throws ESRCH which the helper should map to ok:true.
      const result = await killProcessTree(999999999)
      expect(result).toEqual({ ok: true })
    }
  )
})
