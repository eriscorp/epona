import { describe, it, expect } from 'vitest'
import { buildHint, ROSETTA_HINT } from './buildHints.js'

// The lines a Mac with no Rosetta prints when the server's build runs protoc
// (HTOO-591, HS-1677).
const MSB6003 =
  '/Users/me/.nuget/packages/grpc.tools/2.67.0/build/_protobuf/Google.Protobuf.Tools.targets(280,5): error MSB6003: The specified task executable "/Users/me/.nuget/packages/grpc.tools/2.67.0/tools/macosx_x64/protoc" could not be run. System.ComponentModel.Win32Exception (86): An error occurred trying to start process'
const BAD_CPU =
  "  An error occurred trying to start process 'protoc' with working directory '/x'. Bad CPU type in executable"

describe('buildHint', () => {
  it('names Rosetta for the Bad CPU type failure on macOS (HTOO-591)', () => {
    expect(buildHint(MSB6003, 'darwin')).toBe(ROSETTA_HINT)
    expect(buildHint(BAD_CPU, 'darwin')).toBe(ROSETTA_HINT)
    expect(ROSETTA_HINT).toContain('softwareupdate --install-rosetta --agree-to-license')
  })

  it('says nothing for other lines, and off macOS', () => {
    expect(
      buildHint('error CS0246: The type or namespace name could not be found', 'darwin')
    ).toBeNull()
    expect(buildHint(MSB6003, 'linux')).toBeNull()
    expect(buildHint(MSB6003, 'win32')).toBeNull()
  })
})
