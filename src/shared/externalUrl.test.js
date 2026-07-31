import { describe, it, expect } from 'vitest'
import { isSafeExternalUrl } from './externalUrl.js'

describe('isSafeExternalUrl', () => {
  it('allows the web schemes Epona actually opens', () => {
    expect(isSafeExternalUrl('https://github.com/hybrasyl/cernunnos/issues/new')).toBe(true)
    expect(isSafeExternalUrl('http://www.hybrasyl.com')).toBe(true)
    expect(isSafeExternalUrl('mailto:hybrasyl@eris.co')).toBe(true)
  })

  it('refuses schemes that reach the local machine or a share', () => {
    expect(isSafeExternalUrl('file:///C:/Windows/System32/calc.exe')).toBe(false)
    expect(isSafeExternalUrl('smb://attacker/share')).toBe(false)
    expect(isSafeExternalUrl('ms-msdt:/id')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
  })

  it('refuses anything that is not a parseable URL', () => {
    expect(isSafeExternalUrl('')).toBe(false)
    expect(isSafeExternalUrl('/etc/passwd')).toBe(false)
    expect(isSafeExternalUrl('www.hybrasyl.com')).toBe(false)
    expect(isSafeExternalUrl(undefined)).toBe(false)
    expect(isSafeExternalUrl(null)).toBe(false)
    expect(isSafeExternalUrl(42)).toBe(false)
  })

  it('is case-insensitive on the scheme, as the URL parser normalises it', () => {
    expect(isSafeExternalUrl('HTTPS://hybrasyl.com')).toBe(true)
    expect(isSafeExternalUrl('FILE:///C:/')).toBe(false)
  })
})
