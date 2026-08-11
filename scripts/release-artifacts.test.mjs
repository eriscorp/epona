import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

/**
 * Every packaging target `electron-builder.yml` declares must reach the
 * published release, and this file is the only thing that can say so on a
 * commit.
 *
 * **A requirement expressed only as a list of globs cannot report the entry
 * that is missing from the list.** `fail_on_unmatched_files: true` is loud
 * about a glob with no file behind it and silent about a file nobody asked
 * for, so a declared target that no glob collects is published by nothing and
 * complained about by no one. HTOO-244 found that on a balor release
 * candidate, which shipped four assets where five were configured; HTOO-369
 * found the same shape in taliesin, which had declared `nsis` since WP14 while
 * its workflow packaged `--win portable` and its release job had no installer
 * glob. Every gate in both repositories passed the whole time.
 *
 * Epona is the repository the other two were fixed to MATCH, so this is a
 * regression guard rather than a fix — nothing here is currently wrong. The
 * point is that nothing was pinning it, and Epona has the widest surface of
 * the three: five targets across three operating systems, five release globs,
 * three upload steps, and a signing arrangement that has already been got
 * wrong once (see docs/antivirus.md).
 *
 * Read as raw text rather than parsed: there is no YAML dependency in this
 * repository, these are files it owns, and the job is to catch a human edit
 * rather than to be a general parser.
 */

const REPO_ROOT = join(import.meta.dirname, '..')

/**
 * Comments out before any anchored pattern is matched, in BOTH files.
 *
 * The comment explaining why the packaging step must not name a target
 * necessarily contains the form it is forbidding, and `electron-builder.yml`
 * carries long comments quoting the very values asserted below — the
 * `signingHashAlgorithms` note spells out the two-algorithm default it exists
 * to prevent. An assertion that reads the raw file fails against a correct
 * one. Describe the pattern; never write it.
 *
 * Line-wise rather than one multiline regex, so a `#` inside a value can never
 * be mistaken for the start of a comment.
 */
const stripComments = (text) =>
  text
    .split('\n')
    .map((line) => (line.trimStart().startsWith('#') ? '' : line))
    .join('\n')

const builder = stripComments(readFileSync(join(REPO_ROOT, 'electron-builder.yml'), 'utf8'))
const workflow = stripComments(
  readFileSync(join(REPO_ROOT, '.github/workflows/release.yml'), 'utf8')
)

/** The `files:` block of the Create GitHub Release step. */
const releaseGlobs = (() => {
  const start = workflow.indexOf('          files: |')
  expect(start).toBeGreaterThan(-1)
  const globs = []
  for (const line of workflow.slice(start).split('\n').slice(1)) {
    if (!/^ {12}\S/.test(line)) break // the block ends at the next shallower key
    globs.push(line.trim())
  }
  return globs
})()

// suffix → the glob that must publish it. Keyed on what the artifact is
// CALLED, because that is what both halves have to agree about: the left is
// derived from electron-builder.yml's artifactName templates, the right is what
// the workflow asks GitHub to upload.
const EXPECTED = [
  { target: 'nsis', suffix: '-setup.exe', job: 'build-windows' },
  { target: 'portable', suffix: '-portable.exe', job: 'build-windows' },
  { target: 'AppImage', suffix: '.AppImage', job: 'build-linux' },
  { target: 'deb', suffix: '.deb', job: 'build-linux' },
  { target: 'dmg', suffix: '.dmg', job: 'build-mac' }
]

// Published, but produced by the release job itself rather than by a packaging
// target. It has to be named here or the both-directions check below reads it
// as a glob with nothing behind it — which is exactly the alarm this file
// exists to raise, so the exception is written down rather than the check
// loosened.
const NON_TARGET_ASSETS = ['SHA256SUMS.txt']

describe('every configured target reaches the release', () => {
  it.each(EXPECTED)('$target is declared, and has a release glob', ({ target, suffix }) => {
    expect(builder).toMatch(new RegExp(`^\\s*(- )?(target: )?${target}\\s*$`, 'm'))
    expect(releaseGlobs.some((g) => g.endsWith(suffix))).toBe(true)
  })

  it('publishes nothing the configuration does not declare', () => {
    // The other direction, and it is not symmetry for its own sake. A glob with
    // no target behind it makes `fail_on_unmatched_files: true` red on every
    // release until somebody deletes the glob — a failure that arrives on a
    // tag, which is the most expensive moment to find one.
    const known = [...EXPECTED.map((e) => e.suffix), ...NON_TARGET_ASSETS]
    for (const glob of releaseGlobs) {
      expect(known.some((suffix) => glob.endsWith(suffix))).toBe(true)
    }
    expect(releaseGlobs).toHaveLength(known.length)
  })

  it('uploads every artifact out of the job that builds it', () => {
    // The step between packaging and publishing, and the one the release job's
    // globs cannot speak for: `artifacts/**` can only match what was uploaded.
    // `if-no-files-found: error` then covers each name, so a rename in
    // electron-builder.yml fails the build rather than shipping one artifact.
    for (const { suffix } of EXPECTED) {
      expect(workflow).toContain(`dist/*${suffix}`)
    }
    expect(workflow.match(/if-no-files-found: error/g)).toHaveLength(3)
  })

  it('waits for every build job before publishing', () => {
    // A fourth build job added without extending `needs:` would not fail — the
    // release would simply publish without its artifact, and `artifacts/**`
    // would match nothing for it.
    const needs = workflow.match(/^ {4}needs: \[(.+)\]$/m)
    expect(needs).not.toBeNull()
    for (const { job } of EXPECTED) expect(needs[1]).toContain(job)
  })

  it('leaves the Windows target list in electron-builder.yml alone', () => {
    // `--win` with no targets after it. Naming them here as well would put the
    // list in two files, which is the shape taliesin's missing installer came
    // from: the config said two and the workflow said one, and the config is
    // the half a reader checks.
    expect(workflow).toMatch(/npx electron-builder --win --publish never/)
    expect(workflow).not.toMatch(/--win \w/)
  })
})

describe('the Windows signing arrangement', () => {
  it('signs during packaging, not over the finished artifacts', () => {
    // The portable exe is a self-extracting archive. Signing only the two
    // finished files left everything it unpacks into %TEMP% unsigned inside a
    // signed wrapper, which is half of why 2.7.1 tripped
    // Trojan:Win32/Wacatac.C!ml. scripts/sign.js is invoked once per signable
    // binary instead, and the afterPack hook covers da_win32.node, which
    // electron-builder's signable-file walk skips because it is asarUnpack'd.
    // See docs/antivirus.md.
    expect(builder).toMatch(/^ {4}sign: scripts\/sign\.js$/m)
    expect(builder).toMatch(/^afterPack: scripts\/after-pack-sign\.js$/m)
    // The action this replaced. It can only reach finished artifacts, so
    // reintroducing it would restore the arrangement above, quietly.
    expect(workflow).not.toMatch(/sslcom\/esigner-codesign/)
  })

  it('asks for one hash algorithm, so the sign hook runs once per binary', () => {
    // Left unset, electron-builder defaults to two and calls the hook twice per
    // binary. That default assumes signtool.exe, which takes the hash as an
    // argument; CodeSignTool does not, so the second call re-signs identically
    // and burns another Cloud eSigner round trip and TOTP step for nothing.
    expect(builder).toMatch(/^ {4}signingHashAlgorithms:\n {6}- sha256$/m)
  })

  it('refuses to publish a half-signed release', () => {
    // Skipped when no credentials are configured, since then nothing is signed
    // by design — a fork still produces a release, just an unsigned one.
    expect(workflow).toMatch(/name: Verify signatures/)
    expect(workflow).toMatch(/if: env\.ES_USERNAME != ''/)
  })
})

describe('the installer decisions most expensive to revisit', () => {
  it('installs per-user, assisted, with a directory page', () => {
    // perMachine is the expensive one: an existing per-user installation is not
    // upgraded by a per-machine installer, and the user ends up with two.
    // allowToChangeInstallationDirectory only takes effect while oneClick is
    // false, so the three are asserted together rather than separately.
    expect(builder).toMatch(/^ {2}oneClick: false$/m)
    expect(builder).toMatch(/^ {2}perMachine: false$/m)
    expect(builder).toMatch(/^ {2}allowToChangeInstallationDirectory: true$/m)
  })

  it('gives the installer a predictable name for the upload and release globs', () => {
    // The default is "Epona Setup <version>.exe", with spaces. Both halves of
    // the contract above are written against the dashed form.
    expect(builder).toMatch(/^ {2}artifactName: \$\{name\}-\$\{version\}-setup\.\$\{ext\}$/m)
  })
})
