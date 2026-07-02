import { describe, it, expect } from 'vitest'
import { runtimeChip } from './runtimeChip.js'

// Runtime state shapes: dotnetFound null = still probing; netCoreApp10 = the
// .NET 10 runtime is present; sdk10 = the SDK is present.
const state = (over) => ({ dotnetFound: true, netCoreApp10: false, sdk10: false, ...over })

describe('runtimeChip', () => {
  it('shows a checking state while dotnetFound is null', () => {
    expect(runtimeChip(state({ dotnetFound: null }), { needsSdk: false })).toEqual({
      label: 'Checking .NET…',
      color: 'default'
    })
  })

  it('reports .NET not installed when dotnet is absent', () => {
    expect(runtimeChip(state({ dotnetFound: false }), { needsSdk: true })).toEqual({
      label: '.NET not installed',
      color: 'error'
    })
  })

  it('is satisfied by runtime alone when the SDK is not needed', () => {
    expect(runtimeChip(state({ netCoreApp10: true }), { needsSdk: false })).toEqual({
      label: '.NET 10 runtime',
      color: 'success'
    })
  })

  it('needs both runtime and SDK when needsSdk is set', () => {
    expect(runtimeChip(state({ netCoreApp10: true, sdk10: true }), { needsSdk: true })).toEqual({
      label: '.NET 10 runtime + SDK',
      color: 'success'
    })
  })

  it('flags a missing SDK when the runtime is present but needsSdk', () => {
    expect(runtimeChip(state({ netCoreApp10: true, sdk10: false }), { needsSdk: true })).toEqual({
      label: '.NET 10 SDK missing',
      color: 'warning'
    })
  })

  it('flags both missing when neither runtime nor SDK is present and needsSdk', () => {
    expect(runtimeChip(state({ netCoreApp10: false, sdk10: false }), { needsSdk: true })).toEqual({
      label: '.NET 10 runtime + SDK missing',
      color: 'warning'
    })
  })

  it('flags a missing runtime when the SDK is not needed', () => {
    expect(runtimeChip(state({ netCoreApp10: false }), { needsSdk: false })).toEqual({
      label: '.NET 10 runtime missing',
      color: 'warning'
    })
  })
})
