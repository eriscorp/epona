import { describe, it, expect } from 'vitest'
import { installItems } from './installHints.js'

describe('installItems', () => {
  // The supported macOS install is Microsoft's SDK through the cask, which puts
  // .NET in /usr/local/share/dotnet where an apphost finds it with no
  // DOTNET_ROOT. The dotnet formula does not, and a binary-mode client then
  // fails from Finder (HTOO-645, M4).
  it('on macOS, names the dotnet-sdk cask, not the dotnet formula', () => {
    const dotnet = installItems('darwin').find((i) => i.key === 'dotnet')
    expect(dotnet.command).toBe('brew install --cask dotnet-sdk')
  })

  it('on Linux, names the apt SDK package', () => {
    const sdk = installItems('linux').find((i) => i.key === 'dotnet-sdk')
    expect(sdk.command).toBe('sudo apt install dotnet-sdk-10.0')
  })
})
