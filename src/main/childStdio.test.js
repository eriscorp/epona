import { spawn } from 'child_process'
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { childStdio, leakedFds } from './childStdio.js'

// HTOO-661, fault 2. The flags are octal, as /proc prints them: 02000000 is
// O_CLOEXEC, 02 is O_RDWR, 0100000 is O_LARGEFILE.
function fakeProc(flagsByFd) {
  return {
    platform: 'linux',
    readdir: () => ['0', '1', '2', ...Object.keys(flagsByFd)],
    readFile: (path) => {
      const fd = path.split('/').pop()
      if (!(fd in flagsByFd)) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      return `pos:\t0\nflags:\t${flagsByFd[fd]}\nmnt_id:\t29\nino:\t1\n`
    }
  }
}

describe('leakedFds', () => {
  it('lists the descriptors above 2 without close-on-exec, in order', () => {
    const proc = fakeProc({ 41: '0100000', 5: '02100002', 7: '02', 30: '02000000' })
    expect(leakedFds(proc)).toEqual([7, 41])
  })

  it('skips a descriptor that closed after the listing', () => {
    const proc = fakeProc({ 9: '0100000' })
    const readdir = () => ['0', '1', '2', '8', '9']
    expect(leakedFds({ ...proc, readdir })).toEqual([9])
  })

  it('is empty off Linux, and when /proc cannot be read', () => {
    expect(leakedFds({ ...fakeProc({ 9: '0' }), platform: 'darwin' })).toEqual([])
    expect(leakedFds({ ...fakeProc({ 9: '0' }), platform: 'win32' })).toEqual([])
    const readdir = () => {
      throw new Error('no /proc')
    }
    expect(leakedFds({ ...fakeProc({}), readdir })).toEqual([])
  })
})

describe('childStdio', () => {
  const nullFd = () => 99

  it('returns stdio as it is when nothing leaks', () => {
    const stdio = ['ignore', 'pipe', 'pipe']
    expect(childStdio(stdio, { fds: [], nullFd })).toBe(stdio)
    expect(childStdio('ignore', { fds: [], nullFd })).toBe('ignore')
  })

  it('puts /dev/null at each leaked index, and ignore in the gaps', () => {
    expect(childStdio(['ignore', 'pipe', 'pipe'], { fds: [3, 6], nullFd })).toEqual([
      'ignore',
      'pipe',
      'pipe',
      99,
      'ignore',
      'ignore',
      99
    ])
  })

  it("expands a string to the three standard streams, and uses spawn's default", () => {
    expect(childStdio('ignore', { fds: [4], nullFd })).toEqual([
      'ignore',
      'ignore',
      'ignore',
      'ignore',
      99
    ])
    expect(childStdio(undefined, { fds: [3], nullFd })).toEqual(['pipe', 'pipe', 'pipe', 99])
  })

  it('keeps an entry that the caller gave for a leaked index', () => {
    expect(childStdio(['ignore', 'pipe', 'pipe', 'ipc'], { fds: [3, 4], nullFd })).toEqual([
      'ignore',
      'pipe',
      'pipe',
      'ipc',
      99
    ])
  })

  it('opens /dev/null only when something leaks', () => {
    let opened = 0
    const counting = () => ++opened
    childStdio('pipe', { fds: [], nullFd: counting })
    expect(opened).toBe(0)
    childStdio('pipe', { fds: [5], nullFd: counting })
    expect(opened).toBe(1)
  })
})

// The real thing, on Linux only (the Linux box and the POSIX CI job run it).
//
// Node cannot make the leak itself: it opens every descriptor with
// close-on-exec, and a Node child sets close-on-exec on what it inherits. So
// `sh` holds the leak. A file given to `sh` as fd 5 stays open there without
// close-on-exec, which is how Chromium's files sit in Epona. The two tests
// read that real /proc, and spawn real children.
describe.runIf(process.platform === 'linux')('a real spawn on Linux', () => {
  let dir, file, fd
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'epona-fds-'))
    file = join(dir, 'held.txt')
    writeFileSync(file, 'held')
    fd = openSync(file, 'r')
  })
  afterAll(() => {
    closeSync(fd)
    rmSync(dir, { recursive: true, force: true })
  })

  // What `sh` has at fd 5, as `readlink` reads it.
  function fd5(stdio) {
    return new Promise((resolve, reject) => {
      const c = spawn('sh', ['-c', 'readlink /proc/$$/fd/5 || echo none'], { stdio })
      let out = ''
      c.stdout.on('data', (d) => (out += d))
      c.on('error', reject)
      c.on('close', () => resolve(out.trim()))
    })
  }

  it('finds a descriptor that a process holds without close-on-exec', async () => {
    const c = spawn('sh', ['-c', 'sleep 5'], {
      stdio: ['ignore', 'ignore', 'ignore', 'ignore', 'ignore', fd]
    })
    try {
      await new Promise((resolve) => c.on('spawn', resolve))
      expect(leakedFds({ proc: `/proc/${c.pid}` })).toContain(5)
      // This process opened the same file with close-on-exec, so it does not leak here.
      expect(leakedFds()).not.toContain(fd)
    } finally {
      c.kill()
    }
  })

  it('gives the child /dev/null at a leaked index, and nothing else changes', async () => {
    // Guard the guard: a child that gets the file at fd 5 shows it.
    expect(await fd5(['ignore', 'pipe', 'inherit', 'ignore', 'ignore', fd])).toBe(file)
    const stdio = childStdio(['ignore', 'pipe', 'inherit'], { fds: [5] })
    expect(await fd5(stdio)).toBe('/dev/null')
    expect(await fd5(['ignore', 'pipe', 'inherit'])).toBe('none')
  })
})
