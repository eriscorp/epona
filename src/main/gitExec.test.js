import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const spawn = vi.fn()
vi.mock('child_process', async (importActual) => ({
  ...(await importActual()),
  spawn: (...args) => spawn(...args)
}))

const { runGit, ensureDir } = await import('./gitExec.js')

// A stand-in for the ChildProcess runGit wires itself to. Returned synchronously
// so the caller can attach handlers, then driven by the test.
function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.finish = ({ code = 0, out = '', err = '' }) => {
    if (out) child.stdout.emit('data', Buffer.from(out))
    if (err) child.stderr.emit('data', Buffer.from(err))
    child.emit('exit', code)
  }
  return child
}

beforeEach(() => {
  spawn.mockReset()
})

describe('runGit argv contract', () => {
  // SECURITY.md:29 names this as the protection against shell injection through
  // branch and path input, which the renderer supplies.
  it('spawns git with an argv array and never a shell', () => {
    const child = fakeChild()
    spawn.mockReturnValue(child)
    const p = runGit('D:/repo', ['status', '--porcelain'])
    child.finish({ out: '' })

    const [cmd, args, opts] = spawn.mock.calls[0]
    expect(cmd).toBe('git')
    expect(args).toEqual(['-C', 'D:/repo', 'status', '--porcelain'])
    // The whole point: no `shell: true`, explicit or inherited.
    expect(opts.shell).toBeUndefined()
    expect(opts.windowsHide).toBe(true)
    return p
  })

  it('keeps a shell-metacharacter branch name as one argv element', () => {
    const child = fakeChild()
    spawn.mockReturnValue(child)
    const hostile = 'main; rm -rf / #'
    const p = runGit('D:/repo', ['rev-parse', hostile])
    child.finish({ out: '' })

    // Not split, not quoted, not escaped — passed through as a single argument,
    // which is what makes escaping unnecessary rather than merely absent.
    expect(spawn.mock.calls[0][1]).toEqual(['-C', 'D:/repo', 'rev-parse', hostile])
    return p
  })

  it('does not interpret a metacharacter cwd either', () => {
    const child = fakeChild()
    spawn.mockReturnValue(child)
    const p = runGit('D:/repo && calc.exe', ['status'])
    child.finish({ out: '' })
    expect(spawn.mock.calls[0][1][1]).toBe('D:/repo && calc.exe')
    return p
  })
})

describe('runGit output and failure handling', () => {
  it('strips trailing whitespace but keeps leading whitespace', async () => {
    const child = fakeChild()
    spawn.mockReturnValue(child)
    const p = runGit('D:/repo', ['branch', '-a'])
    // `branch -a` uses the leading columns for the current-branch marker, so
    // trimming both ends would lose which branch is checked out.
    child.finish({ out: '  main\n* develop\n\n' })
    await expect(p).resolves.toMatchObject({ code: 0, stdout: '  main\n* develop' })
  })

  it('rejects with stderr in the message on a non-zero exit', async () => {
    const child = fakeChild()
    spawn.mockReturnValue(child)
    const p = runGit('D:/repo', ['worktree', 'add', 'x'])
    child.finish({ code: 128, err: "fatal: 'x' already exists\n" })
    await expect(p).rejects.toThrow(/exit 128.*already exists/s)
  })

  it('says so when a failing command printed nothing', async () => {
    const child = fakeChild()
    spawn.mockReturnValue(child)
    const p = runGit('D:/repo', ['bad'])
    child.finish({ code: 1 })
    await expect(p).rejects.toThrow(/\(no stderr\)/)
  })

  it('resolves a non-zero exit under allowFail, with the code', async () => {
    const child = fakeChild()
    spawn.mockReturnValue(child)
    const p = runGit('D:/repo', ['diff', '--quiet'], { allowFail: true })
    child.finish({ code: 1, err: 'noise' })
    await expect(p).resolves.toMatchObject({ code: 1, stderr: 'noise' })
  })

  it('rejects when the process cannot be spawned at all', async () => {
    const child = fakeChild()
    spawn.mockReturnValue(child)
    const p = runGit('D:/repo', ['status'])
    // git missing from PATH surfaces here, not as an exit code.
    child.emit('error', new Error('spawn git ENOENT'))
    await expect(p).rejects.toThrow(/ENOENT/)
  })
})

describe('ensureDir', () => {
  let workDir

  beforeEach(async () => {
    workDir = await fs.mkdtemp(join(tmpdir(), 'epona-gitexec-'))
  })

  afterEach(async () => {
    if (workDir) await fs.rm(workDir, { recursive: true, force: true })
  })

  it('returns a directory unchanged', async () => {
    await expect(ensureDir(workDir)).resolves.toBe(workDir)
  })

  it('returns the parent of a file', async () => {
    const file = join(workDir, 'Hybrasyl.Xml.csproj')
    await fs.writeFile(file, 'x')
    await expect(ensureDir(file)).resolves.toBe(workDir)
  })

  it('returns a non-existent path as-is rather than guessing', async () => {
    const missing = join(workDir, 'nope', 'gone')
    await expect(ensureDir(missing)).resolves.toBe(missing)
  })
})
