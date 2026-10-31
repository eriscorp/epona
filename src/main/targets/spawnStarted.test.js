import { describe, it, expect } from 'vitest'
import { spawn } from 'child_process'
import { spawnStarted, describeSpawnError } from './spawnStarted.js'

// Real spawns, as processKill.test.js does: the point is when Node reports
// the outcome, which a mocked child cannot show.
describe('spawnStarted (HTOO-594)', () => {
  it('resolves null once the program runs', async () => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    await expect(spawnStarted(child)).resolves.toBeNull()
  })

  it('resolves the error for a program that does not exist', async () => {
    // spawn() returns at once; the ENOENT comes later as an 'error' event. A
    // launch that returned at once reported success with no pid.
    const child = spawn('epona-no-such-program', [], { stdio: 'ignore' })
    expect(child.pid).toBeUndefined()
    await expect(spawnStarted(child)).resolves.toMatchObject({ code: 'ENOENT' })
  })
})

describe('describeSpawnError', () => {
  it('names the CPU type for errno -86, which Node gives no name (HTOO-594)', () => {
    const err = Object.assign(new Error('spawn Unknown system error -86'), { errno: -86 })
    expect(describeSpawnError(err)).toBe(
      'wrong CPU type: this program needs Rosetta or an arm64 build'
    )
  })

  it('names chmod +x for EACCES', () => {
    const err = Object.assign(new Error('spawn /x/Brigid EACCES'), { code: 'EACCES' })
    expect(describeSpawnError(err)).toBe(
      'spawn /x/Brigid EACCES. Check that the file is executable (chmod +x).'
    )
  })

  it('gives any other error as it is', () => {
    expect(describeSpawnError(new Error('spawn dotnet ENOENT'))).toBe('spawn dotnet ENOENT')
  })
})
