// The renderer runs SANDBOXED, so Node's globals are not there (HTOO-393).
//
// Ported from creidhne, which took it from balor. Balor has it because of a real
// failure: a page read `process.platform` for one sentence, passed typecheck,
// lint, 2430 unit and jsdom assertions and 30 of 30 e2e, and threw
// `ReferenceError` the first time a person clicked its tab. Epona's main window
// runs `sandbox: true` (src/main/index.js).
//
// **Every gate was blind to it, and one for a reason no care fixes: vitest runs
// in Node.** The jsdom environment gives a component a DOM, never a renderer, and
// Node's globals are present in it by construction. The environment cannot be
// made to tell the truth either (react-dom's development build reads `NODE_ENV`
// off the very global that would have to go), so the check reads the SOURCE.
//
// Renderer only. `src/main` is Node and uses these freely. `src/shared` is
// loaded by the node environment and by the renderer bundle, and its own rule
// keeps it free of electron and node imports. e2e/nav-pages.spec.js catches the
// rest of the class: it opens every tab in the real renderer.
//
// A platform fact the renderer needs comes from main, through the preload
// bridge (`window.sparkAPI.platform`). Do not read a global in the preload to
// answer it a second way.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// The renderer source root: this file's own directory.
const RENDERER_SRC = dirname(fileURLToPath(import.meta.url))

/**
 * The globals a bundler leaves alone and a sandboxed renderer does not have.
 *
 * **Two groups, because the false-positive risk differs.** `process`, `Buffer`
 * and `require` are ordinary English words, so a bare match reds on prose — and
 * stripping comments does not save it, because the prose that matters is JSX
 * TEXT. The first port of this check found exactly that in Epona:
 * `Epona cannot reach its background process.` matched, on the full stop that
 * ends the sentence. So these three must be followed by a real USE — a property
 * access, a call or an index — and a trailing `.` with nothing after it is not
 * one.
 *
 * `__dirname` and `__filename` are not words, and their ordinary use is BARE
 * (`join(__dirname, x)`), so a required access there would miss every real
 * case. They are matched as identifiers.
 */
const WORD_LIKE = ['process', 'Buffer', 'require']
const BARE = ['__dirname', '__filename']
const NODE_GLOBALS = [...WORD_LIKE, ...BARE]

/** A property access, a call or an index. **No whitespace is allowed after the
 *  dot.** That is what separates `process.platform` from `cannot reach the
 *  process. Restart it.`: the second sentence puts a capital letter two
 *  characters after the full stop, and it matched until this rule came in. The
 *  cost is a chained `process` split across lines, which no formatter here
 *  produces for a global. */
function useOf(name) {
  return WORD_LIKE.includes(name)
    ? new RegExp(`\\b${name}\\s*(?:\\.[A-Za-z_$]|\\(|\\[)`)
    : new RegExp(`\\b${name}\\b`)
}

/** Comments first. A comment may name any of these — this file's own header
 *  does — and the rule is to describe the pattern, not to reproduce it. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Every renderer source file that ships. Tests are colocated here and run in
 *  vitest, not in the renderer, so they are left out — this file most of all.
 *  A hand-rolled walk, because `fs.globSync` is still experimental on the Node
 *  this project builds against. */
function rendererSources(dir = RENDERER_SRC) {
  const found = []
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.isDirectory()) {
      found.push(...rendererSources(join(dir, item.name)))
    } else if (/\.jsx?$/.test(item.name) && !/\.test\.jsx?$/.test(item.name)) {
      found.push(join(dir, item.name))
    }
  }
  return found
}

describe('the renderer never touches a Node global', () => {
  // The assertion that would have caught balor's fault before it reached a click.
  it.each(NODE_GLOBALS)('never reads `%s`', (name) => {
    const pattern = useOf(name)
    const offenders = rendererSources()
      .filter((file) => pattern.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => file.slice(RENDERER_SRC.length + 1))

    // Named in the failure, so the message is the fix and not a boolean.
    expect(offenders).toEqual([])
  })

  // Without this the suite above passes on an empty list. A walk that silently
  // matches nothing reads as coverage.
  it('actually read the renderer', () => {
    const files = rendererSources()
    expect(files.length).toBeGreaterThan(40)
    expect(files.some((f) => f.endsWith('App.jsx'))).toBe(true)
    expect(files.some((f) => f.endsWith('.test.js') || f.endsWith('.test.jsx'))).toBe(false)
  })

  // And that the matcher can fail at all. A regex that matches nothing anywhere
  // passes every case above for the wrong reason.
  it('matches a use, and not a mention', () => {
    const pattern = useOf('process')
    expect(pattern.test('const p = process' + '.platform')).toBe(true)
    expect(pattern.test('the build process is slow')).toBe(false)
  })

  // The regression this check earned when it was first ported. A sentence in JSX
  // TEXT that ends in the word matched, because the full stop looked like a
  // property access. Comment-stripping cannot help, because it is not a comment.
  it('does not match a sentence that merely ENDS in the word', () => {
    const pattern = useOf('process')
    expect(pattern.test('Epona cannot reach its background process.')).toBe(false)
    expect(pattern.test('cannot reach the process. Restart it.')).toBe(false)
  })

  // And the bare pair still match the way they are really written — a required
  // access there would miss `join(__dirname, x)`, which is every real use.
  it('matches __dirname bare, because that is how it is used', () => {
    expect(useOf('__dirname').test('join(__dirname, x)')).toBe(true)
    expect(useOf('__filename').test('const f = __filename')).toBe(true)
  })
})
