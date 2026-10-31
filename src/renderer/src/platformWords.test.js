import { describe, it, expect } from 'vitest'
import {
  fileManagerName,
  worldFolderPlaceholder,
  serverBinaryLabel,
  serverBinaryFilters
} from './platformWords.js'

describe('platformWords (HTOO-596)', () => {
  it("names each OS's file manager", () => {
    expect(fileManagerName('win32')).toBe('Explorer')
    expect(fileManagerName('darwin')).toBe('Finder')
    expect(fileManagerName('linux')).toBe('the file manager')
  })

  it('gives a world folder for each OS, with single backslashes on Windows (F20)', () => {
    // Each `\\` here is one backslash in the string.
    expect(worldFolderPlaceholder('win32')).toBe('C:\\Hybrasyl\\world')
    expect(worldFolderPlaceholder('win32')).not.toContain('\\\\')
    expect(worldFolderPlaceholder('darwin')).toMatch(/^\/Users\//)
    expect(worldFolderPlaceholder('linux')).toMatch(/^\/home\//)
  })

  it('offers the server .exe on Windows only, and any program elsewhere (F10)', () => {
    expect(serverBinaryLabel('win32')).toMatch(/\.exe/)
    expect(serverBinaryLabel('linux')).not.toMatch(/\.exe/)
    expect(serverBinaryFilters('win32')[0].extensions).toContain('exe')
    expect(serverBinaryFilters('darwin').flatMap((f) => f.extensions)).not.toContain('exe')
  })
})
