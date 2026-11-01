import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { tailFile } from './fileTail.js'

// Real files in a temp folder: the console script on Windows appends to one
// while Epona reads it (HTOO-652).
let dir
let file

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'epona-tail-'))
  file = join(dir, 'console.log')
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms))

describe('tailFile (HTOO-652)', () => {
  it('emits the lines that are appended, as they arrive', async () => {
    await fs.writeFile(file, '')
    const lines = []
    const tail = tailFile(file, (l) => lines.push(l), { intervalMs: 10 })

    await fs.appendFile(file, 'Building...\r\n')
    await tick()
    expect(lines).toEqual(['Building...'])
    await fs.appendFile(file, '[INF] Lobby listening on 2610\n')
    await tick()
    await tail.stop()

    expect(lines).toEqual(['Building...', '[INF] Lobby listening on 2610'])
  })

  it('waits for a file that is not there yet', async () => {
    const lines = []
    const tail = tailFile(file, (l) => lines.push(l), { intervalMs: 10 })
    await tick()
    await fs.writeFile(file, 'first\n')
    await tick()
    await tail.stop()
    expect(lines).toEqual(['first'])
  })

  it('emits a last line with no newline when stopped', async () => {
    await fs.writeFile(file, 'done\n[epona] The server exited with code 1.')
    const lines = []
    const tail = tailFile(file, (l) => lines.push(l), { intervalMs: 1000 })
    await tail.stop()
    expect(lines).toEqual(['done', '[epona] The server exited with code 1.'])
  })

  it('reads a file that was started again from its start', async () => {
    await fs.writeFile(file, 'an old run that is longer\n')
    const lines = []
    const tail = tailFile(file, (l) => lines.push(l), { intervalMs: 10 })
    await tick()
    await fs.writeFile(file, 'new run\n')
    await tick()
    await tail.stop()
    expect(lines).toEqual(['an old run that is longer', 'new run'])
  })
})
