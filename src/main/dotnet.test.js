import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  resolveDotnetPath,
  runtimeRootFromListRuntimes,
  dotnetRootEnv,
  _resetDotnetPathCache
} from './dotnet.js'

describe('resolveDotnetPath', () => {
  beforeEach(() => _resetDotnetPathCache())

  it('resolves to a non-empty command string', async () => {
    const p = await resolveDotnetPath()
    expect(typeof p).toBe('string')
    expect(p.length).toBeGreaterThan(0)
  })

  it('memoizes — repeated calls return the same value', async () => {
    const a = await resolveDotnetPath()
    const b = await resolveDotnetPath()
    expect(b).toBe(a)
  })
})

describe('runtimeRootFromListRuntimes (HTOO-645)', () => {
  it("gives Homebrew's libexec, not the env script's bin", () => {
    // The `dotnet` formula: bin/dotnet is a script beside libexec/, which holds
    // the runtime. DOTNET_ROOT=bin left the apphost with no runtime (M4).
    const out = [
      'Microsoft.AspNetCore.App 10.0.1 [/opt/homebrew/Cellar/dotnet/10.0.1/libexec/shared/Microsoft.AspNetCore.App]',
      'Microsoft.NETCore.App 10.0.1 [/opt/homebrew/Cellar/dotnet/10.0.1/libexec/shared/Microsoft.NETCore.App]'
    ].join('\n')
    expect(runtimeRootFromListRuntimes(out)).toBe('/opt/homebrew/Cellar/dotnet/10.0.1/libexec')
  })

  it('takes the .NET 10 runtime over an older one listed first', () => {
    const out = [
      'Microsoft.NETCore.App 8.0.11 [/usr/lib/dotnet8/shared/Microsoft.NETCore.App]',
      'Microsoft.NETCore.App 10.0.1 [/home/me/.dotnet/shared/Microsoft.NETCore.App]'
    ].join('\r\n')
    expect(runtimeRootFromListRuntimes(out)).toBe('/home/me/.dotnet')
  })

  it('is null with no .NET runtime listed', () => {
    expect(runtimeRootFromListRuntimes('')).toBeNull()
    expect(
      runtimeRootFromListRuntimes(
        'Microsoft.AspNetCore.App 10.0.1 [/x/shared/Microsoft.AspNetCore.App]'
      )
    ).toBeNull()
  })
})

describe('dotnetRootEnv (HTOO-645)', () => {
  const realPlatform = process.platform
  const realRoot = process.env.DOTNET_ROOT

  beforeEach(() => _resetDotnetPathCache())
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform })
    if (realRoot === undefined) delete process.env.DOTNET_ROOT
    else process.env.DOTNET_ROOT = realRoot
    _resetDotnetPathCache()
  })

  it('adds nothing on Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    delete process.env.DOTNET_ROOT
    await expect(dotnetRootEnv()).resolves.toEqual({})
  })

  it('adds nothing when DOTNET_ROOT is set already', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    process.env.DOTNET_ROOT = '/somewhere'
    await expect(dotnetRootEnv()).resolves.toEqual({})
  })
})
