import { describe, it, expect } from 'vitest'
import { lastErrorLine, serverExitNotice, NOTICE_LINE_MAX } from './serverExitNotice.js'

const out = (text) => ({ stream: 'stdout', text })
const err = (text) => ({ stream: 'stderr', text })
const exit = (text = '— process 1 ended (exit code 1) —') => ({ stream: 'exit', text })

describe('lastErrorLine', () => {
  it('takes the last stderr line over later stdout', () => {
    // HTOO-587: the server refuses a missing log folder on stderr, then prints
    // its usage text on stdout. The usage text is not the error.
    const lines = [
      err('The log directory /Users/x/world/logs does not exist or cannot be read'),
      out('Usage: Hybrasyl [options]'),
      out('  --logDir   the log directory')
    ]
    expect(lastErrorLine(lines)).toBe(
      'The log directory /Users/x/world/logs does not exist or cannot be read'
    )
  })

  it('takes the last stdout line when the run wrote no stderr', () => {
    // A dotnet build writes its errors to stdout.
    const lines = [
      out('error MSB6003: The specified task executable could not be run.'),
      out('The build failed. Fix the build errors and run again.'),
      out('   ')
    ]
    expect(lastErrorLine(lines)).toBe('The build failed. Fix the build errors and run again.')
  })

  it("does not quote an earlier run's error", () => {
    const lines = [err('old failure'), exit(), out('Starting server')]
    expect(lastErrorLine(lines)).toBe('Starting server')
    expect(lastErrorLine([err('old failure'), exit()])).toBeNull()
  })

  it('is null for an empty log', () => {
    expect(lastErrorLine([])).toBeNull()
  })
})

describe('serverExitNotice', () => {
  it('names the server, the exit code and the error line', () => {
    expect(
      serverExitNotice({ name: 'Local', code: 1, signal: null, lines: [err('[FTL] no config')] })
    ).toBe('Server "Local" stopped (exit code 1): [FTL] no config')
  })

  it('names a signal', () => {
    expect(serverExitNotice({ name: 'Local', code: null, signal: 'SIGKILL', lines: [] })).toBe(
      'Server "Local" stopped (signal SIGKILL).'
    )
  })

  it('says a server that never started did not start', () => {
    const lines = [err('[spawn error] spawn dotnet ENOENT')]
    expect(serverExitNotice({ name: 'Local', code: null, signal: null, lines })).toBe(
      'Server "Local" did not start: [spawn error] spawn dotnet ENOENT'
    )
  })

  it('cuts a long line', () => {
    const notice = serverExitNotice({
      name: 'Local',
      code: 1,
      signal: null,
      lines: [err('x'.repeat(500))]
    })
    expect(notice).toBe(`Server "Local" stopped (exit code 1): ${'x'.repeat(NOTICE_LINE_MAX - 1)}…`)
  })
})
