import { test, expect } from '@playwright/test'
import { join } from 'path'
import { launchEpona, getMainWindow, repoRoot } from './helpers.js'
import { RENDERER_CSP, SPLASH_CSP } from '../src/main/windowSecurity.js'

// HTOO-467. The CSP is on the RESPONSE, not only in the meta tags. Ported from
// creidhne's spec, with the header read from mabon's.
//
// The unit tests pin the policy strings, the meta tags and the call site in
// index.js. None of them can show that the header reaches a real response, and
// the rest of the suite passes without it, because the meta tags alone keep the
// built app working. So this file reads the header off real document responses
// through the DevTools protocol.
//
// Note what this file does NOT do: hook `session.webRequest.onHeadersReceived`
// to read the header back. That hook keeps ONE listener per session, and a
// second registration REPLACES the first. A spec that hooked it would remove the
// app's own CSP and then measure its absence.
//
// The e2e helper sets NODE_ENV=test and no ELECTRON_RENDERER_URL, so this is the
// packaged policy, not the dev relaxation.

// A Content-Security-Policy header value from a CDP header map. CDP joins
// repeated headers of one name with a newline, so a second CSP header shows as a
// second line, and `toBe(policy)` fails on it.
function cspHeader(headers) {
  const name = Object.keys(headers).find((h) => h.toLowerCase() === 'content-security-policy')
  return name === undefined ? null : headers[name]
}

// Record, from now on, the CSP header of each document response on `page`, and
// each CSP refusal on its console. Chromium writes every refusal to the console
// ("Refused to load …"), for fonts, images and scripts alike, before any page
// script can listen. Call it before the reload that loads the document.
async function watchDocuments(page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  const documents = []
  cdp.on('Network.responseReceived', (e) => {
    if (e.type === 'Document') documents.push(cspHeader(e.response.headers))
  })
  const refusals = []
  page.on('console', (msg) => {
    if (/Refused to|Content Security Policy/i.test(msg.text())) refusals.push(msg.text())
  })
  return { documents, refusals }
}

test.describe('content security policy', () => {
  let electronApp

  test.afterEach(async () => {
    await electronApp?.close()
  })

  test('the main document has exactly one CSP header, and nothing is refused', async () => {
    ;({ electronApp } = await launchEpona())
    const page = await getMainWindow(electronApp)
    const { documents, refusals } = await watchDocuments(page)

    // Reload, so the response and the whole boot are seen from the start.
    await page.reload()
    await page.waitForSelector('[data-testid="main-panel"]', { state: 'visible' })
    await expect.poll(() => documents.length, { timeout: 10_000 }).toBeGreaterThan(0)
    // Give late loads (fonts, the logo) time to settle before the count.
    await page.waitForTimeout(1500)

    expect(documents[0], 'the document response carries no CSP header').toBe(RENDERER_CSP)
    expect(refusals, 'the renderer refused its own resources').toEqual([])
  })

  test('a policy is in force, and it refuses a remote image', async () => {
    // Asserts the effect rather than the header text. An app with no CSP loads
    // this image and reports `false`, so the assertion cannot pass vacuously.
    ;({ electronApp } = await launchEpona())
    const page = await getMainWindow(electronApp)

    const blocked = await page.evaluate(async () => {
      let violated = false
      const onViolation = (e) => {
        if (e.violatedDirective.startsWith('img-src')) violated = true
      }
      document.addEventListener('securitypolicyviolation', onViolation)
      const img = document.createElement('img')
      // Never resolved: the policy refuses the request before DNS.
      img.src = 'https://example.invalid/probe.png'
      document.body.appendChild(img)
      await new Promise((r) => setTimeout(r, 1000))
      img.remove()
      document.removeEventListener('securitypolicyviolation', onViolation)
      return violated
    })

    expect(blocked, 'a remote image was not refused — img-src is not in force').toBe(true)
  })

  test('the splash has its own header, and its logo still loads', async () => {
    // The app's own splash closes as soon as the renderer is ready, so a read of
    // it races the boot. This loads the same file into a hidden window on the
    // same session: the session's header hook is what is under test, and it
    // applies to every window on that session. Electron's own `debugger` in that
    // window hung the evaluate call, so the read goes through Playwright's CDP.
    ;({ electronApp } = await launchEpona())
    await getMainWindow(electronApp)

    const splashPath = join(repoRoot, 'resources', 'splash.html')
    const opened = electronApp.waitForEvent('window')
    await electronApp.evaluate(({ BrowserWindow }, path) => {
      const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
      win.loadFile(path)
    }, splashPath)
    const splash = await opened
    await splash.waitForLoadState()

    const { documents, refusals } = await watchDocuments(splash)
    await splash.reload()

    const logoWidth = await splash.evaluate(
      () =>
        new Promise((resolve) => {
          const img = document.querySelector('img')
          if (!img) return resolve(0)
          const done = () => resolve(img.naturalWidth)
          if (img.complete) return done()
          img.addEventListener('load', done, { once: true })
          img.addEventListener('error', done, { once: true })
        })
    )
    await expect.poll(() => documents.length, { timeout: 10_000 }).toBeGreaterThan(0)

    expect(documents[0], 'the splash carries the wrong CSP header').toBe(SPLASH_CSP)
    expect(logoWidth, 'the splash logo did not load under its policy').toBeGreaterThan(0)
    expect(refusals, 'the splash refused its own resources').toEqual([])
  })
})
