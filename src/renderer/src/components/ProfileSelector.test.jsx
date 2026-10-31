import { describe, it, expect } from 'vitest'
import { profileCaption } from './ProfileSelector.jsx'

const official = { hostname: 'da0.kru.com', port: 2610, redirect: false }
const local = { hostname: '127.0.0.1', port: 2610, redirect: true }

describe('profileCaption (HTOO-659)', () => {
  it('names the host for the Hybrasyl client, which goes there with or without the redirect', () => {
    // The client gets DA_HOST whenever the profile has a hostname.
    expect(profileCaption(official, 'hybrasyl')).toBe('da0.kru.com:2610')
    expect(profileCaption(local, 'hybrasyl')).toBe('127.0.0.1:2610')
    expect(profileCaption({ ...official, hostname: '' }, 'hybrasyl')).toBe(
      "The client's own server"
    )
  })

  it('keeps the redirect wording for the legacy client', () => {
    expect(profileCaption(official, 'legacy')).toBe('No redirect (official servers)')
    expect(profileCaption(local, 'legacy')).toBe('127.0.0.1:2610')
  })
})
