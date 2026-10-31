import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// Each build job in release.yml validates before it builds (HTOO-651). ci.yml
// runs only when someone dispatches it, so the tag is the one check that always
// runs the POSIX half of the unit suite, and a release that skips it ships what
// nothing tested.

const text = readFileSync(join(import.meta.dirname, '..', '.github/workflows/release.yml'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/^\s*#.*$/gm, '')

/** One job's text, from its two-space header to the next one. */
function job(name) {
  const start = text.indexOf(`\n  ${name}:\n`)
  expect(start, `release.yml has no job ${name}`).toBeGreaterThan(-1)
  const next = text.slice(start + 1).search(/\n {2}[a-z][a-z0-9-]*:\n/)
  return text.slice(start, next === -1 ? undefined : start + 1 + next)
}

describe.each(['build-windows', 'build-linux', 'build-mac'])('%s', (name) => {
  it('runs npm run validate after the install and before the build', () => {
    const steps = job(name)
    const install = steps.indexOf('- name: Install dependencies')
    const validate = steps.indexOf('- name: Validate\n        run: npm run validate\n')
    const build = steps.indexOf('- name: Build app')
    expect(install).toBeGreaterThan(-1)
    expect(validate).toBeGreaterThan(install)
    expect(build).toBeGreaterThan(validate)
  })
})

it('validate is lint, the format check and the unit suite', () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'))
  expect(pkg.scripts.validate).toBe('npm run lint:check && npm run format:check && npm test')
})
