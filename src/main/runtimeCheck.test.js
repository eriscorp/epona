import { describe, it, expect } from 'vitest'
import { parseListRuntimesOutput, parseListSdksOutput, hasRuntime, hasSdk } from './runtimeCheck.js'

const typicalOutput = `Microsoft.AspNetCore.App 6.0.36 [C:\\Program Files\\dotnet\\shared\\Microsoft.AspNetCore.App]
Microsoft.AspNetCore.App 8.0.11 [C:\\Program Files\\dotnet\\shared\\Microsoft.AspNetCore.App]
Microsoft.NETCore.App 6.0.36 [C:\\Program Files\\dotnet\\shared\\Microsoft.NETCore.App]
Microsoft.NETCore.App 8.0.11 [C:\\Program Files\\dotnet\\shared\\Microsoft.NETCore.App]
Microsoft.NETCore.App 10.0.0 [C:\\Program Files\\dotnet\\shared\\Microsoft.NETCore.App]
Microsoft.WindowsDesktop.App 8.0.11 [C:\\Program Files\\dotnet\\shared\\Microsoft.WindowsDesktop.App]
`

describe('parseListRuntimesOutput', () => {
  it('parses the typical `dotnet --list-runtimes` output', () => {
    const runtimes = parseListRuntimesOutput(typicalOutput)
    expect(runtimes).toHaveLength(6)
    expect(runtimes).toContainEqual({ name: 'Microsoft.NETCore.App', version: '10.0.0' })
    expect(runtimes).toContainEqual({ name: 'Microsoft.AspNetCore.App', version: '6.0.36' })
  })

  it('returns an empty array for empty input', () => {
    expect(parseListRuntimesOutput('')).toEqual([])
  })

  it('skips blank and malformed lines', () => {
    const input = '\nMicrosoft.NETCore.App 10.0.0 [path]\n   \nnot a runtime line\n'
    const runtimes = parseListRuntimesOutput(input)
    expect(runtimes).toEqual([{ name: 'Microsoft.NETCore.App', version: '10.0.0' }])
  })

  it('handles CRLF line endings', () => {
    const input = 'Microsoft.NETCore.App 10.0.0 [path]\r\nMicrosoft.NETCore.App 8.0.11 [path]\r\n'
    const runtimes = parseListRuntimesOutput(input)
    expect(runtimes).toHaveLength(2)
  })

  it('keeps preview/rc version suffixes attached to the version string', () => {
    const input = 'Microsoft.NETCore.App 10.0.0-preview.2 [path]\n'
    expect(parseListRuntimesOutput(input)).toEqual([
      { name: 'Microsoft.NETCore.App', version: '10.0.0-preview.2' }
    ])
  })
})

describe('hasRuntime', () => {
  const runtimes = parseListRuntimesOutput(typicalOutput)

  it('detects a matching name and major version', () => {
    expect(hasRuntime(runtimes, 'Microsoft.NETCore.App', 10)).toBe(true)
    expect(hasRuntime(runtimes, 'Microsoft.NETCore.App', 8)).toBe(true)
  })

  it('returns false when the major version is absent', () => {
    expect(hasRuntime(runtimes, 'Microsoft.NETCore.App', 7)).toBe(false)
    expect(hasRuntime(runtimes, 'Microsoft.NETCore.App', 11)).toBe(false)
  })

  it('returns false when the runtime name does not match', () => {
    expect(hasRuntime(runtimes, 'Microsoft.UnknownApp', 10)).toBe(false)
  })

  it('returns false for an empty runtime list', () => {
    expect(hasRuntime([], 'Microsoft.NETCore.App', 10)).toBe(false)
  })
})

const typicalSdkOutput = `6.0.428 [C:\\Program Files\\dotnet\\sdk]
8.0.404 [C:\\Program Files\\dotnet\\sdk]
10.0.100 [C:\\Program Files\\dotnet\\sdk]
`

describe('parseListSdksOutput', () => {
  it('parses the typical `dotnet --list-sdks` output', () => {
    const sdks = parseListSdksOutput(typicalSdkOutput)
    expect(sdks).toHaveLength(3)
    expect(sdks).toContainEqual({ version: '10.0.100' })
    expect(sdks).toContainEqual({ version: '6.0.428' })
  })

  it('returns an empty array for empty input', () => {
    expect(parseListSdksOutput('')).toEqual([])
  })

  it('skips blank and malformed lines', () => {
    const input = '\n10.0.100 [path]\n   \nnot an sdk line\n'
    expect(parseListSdksOutput(input)).toEqual([{ version: '10.0.100' }])
  })

  it('handles CRLF line endings', () => {
    const input = '10.0.100 [path]\r\n8.0.404 [path]\r\n'
    expect(parseListSdksOutput(input)).toHaveLength(2)
  })

  it('keeps preview/rc version suffixes attached to the version string', () => {
    const input = '10.0.100-preview.7.25380.108 [path]\n'
    expect(parseListSdksOutput(input)).toEqual([{ version: '10.0.100-preview.7.25380.108' }])
  })
})

describe('hasSdk', () => {
  const sdks = parseListSdksOutput(typicalSdkOutput)

  it('detects a matching major version', () => {
    expect(hasSdk(sdks, 10)).toBe(true)
    expect(hasSdk(sdks, 8)).toBe(true)
    expect(hasSdk(sdks, 6)).toBe(true)
  })

  it('returns false when the major version is absent', () => {
    expect(hasSdk(sdks, 7)).toBe(false)
    expect(hasSdk(sdks, 11)).toBe(false)
  })

  it('returns false for an empty sdk list', () => {
    expect(hasSdk([], 10)).toBe(false)
  })
})
