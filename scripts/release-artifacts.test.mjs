import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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

describe('after the release is published', () => {
  it('reminds the releaser to publish the version manifest, before Discord', () => {
    // The workflow has no credential for the house version manifest, so a
    // person runs `npm run publish:version` (update-check module v1, HTOO-382).
    // Until they do, running copies of Epona do not see the release. The step
    // comes before Discord, so a failed webhook cannot skip it.
    const remind = workflow.indexOf('- name: Remind to publish the version manifest')
    const release = workflow.indexOf('- name: Create GitHub Release')
    const discord = workflow.indexOf('- name: Notify Discord')
    expect(remind).toBeGreaterThan(release)
    expect(remind).toBeLessThan(discord)
    expect(workflow.slice(remind, discord)).toContain(
      'npm run publish:version -- ${{ github.ref_name }}'
    )
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
    expect(pkg.scripts['publish:version']).toBe('node scripts/publish-version.mjs')
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

/** One build job's text, from its key to the next job's key. */
const jobText = (job) => {
  const start = workflow.indexOf(`\n  ${job}:\n`)
  expect(start, `release.yml has no ${job} job`).toBeGreaterThan(-1)
  const rest = workflow.slice(start + 1)
  const next = rest.slice(1).search(/^ {2}[a-z][\w-]*:$/m)
  return next === -1 ? rest : rest.slice(0, next + 1)
}

/** Where a step sits in a job, by its exact `name:`. -1 when it is absent. */
const stepAt = (text, name) => text.indexOf(`      - name: ${name}\n`)

describe('the Electron fuse check in each build job (HTOO-374)', () => {
  // The paths come from electron-builder.yml and package.json, not from this
  // file, because the failure to catch is a rename in one place only. A wrong
  // path does not pass quietly — the reader exits 2 — but it fails on a tag,
  // which is the most expensive moment to find it.
  const productName = builder.match(/^productName: (\S+)$/m)?.[1]
  // Inside the `win:` block only. Another platform can set its own
  // executableName, and the first match in the file is then the wrong one.
  const winBlock = builder.split(/^win:$/m)[1]?.split(/^\S/m)[0] ?? ''
  const winExecutable = winBlock.match(/^ {2}executableName: (\S+)$/m)?.[1]
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))

  const CHECKS = [
    {
      job: 'build-windows',
      path: `dist/win-unpacked/${winExecutable}.exe`,
      after: 'Package installer + portable exe',
      before: 'Upload Windows artifacts'
    },
    {
      // electron-builder names the Linux executable after package.json `name`,
      // lowercased, and ignores productName for it.
      job: 'build-linux',
      path: `dist/linux-unpacked/${pkg.name.toLowerCase()}`,
      after: 'Package Linux deb + AppImage',
      before: 'Upload Linux artifacts'
    },
    {
      // Before the dmg step as well as the upload: signing a dmg whose app has
      // the wrong fuses only makes a signed wrong dmg.
      job: 'build-mac',
      path: `dist/mac-universal/${productName}.app`,
      after: 'Package, sign + notarize app',
      before: 'Sign, notarize + staple the dmg'
    }
  ]

  it.each(CHECKS)('$job reads the fuse wire off $path', ({ job, path }) => {
    expect(jobText(job)).toContain(`run: npm run verify:fuses -- ${path}\n`)
  })

  it.each(CHECKS)('$job reads it after $after and before $before', ({ job, after, before }) => {
    // Before packaging there is nothing to read. After upload the artifact is
    // already on its way to the release.
    const text = jobText(job)
    const verify = stepAt(text, 'Verify Electron fuses')
    const packaged = stepAt(text, after)
    expect(verify).toBeGreaterThan(-1)
    expect(packaged).toBeGreaterThan(-1)
    expect(packaged).toBeLessThan(verify)
    expect(stepAt(text, before)).toBeGreaterThan(verify)
  })

  it('reads a universal app on macOS, because the mac target is universal', () => {
    // The mac path above is only `mac-universal` while the dmg target is
    // `arch: universal`. That target is also the reason the reader scans every
    // sentinel. If it narrows to one arch, the path and that reasoning both
    // change, and this says so instead of the tag.
    expect(builder).toMatch(/^ {4}- target: dmg\n {6}arch: universal$/m)
  })

  it('runs the reader the npm script names', () => {
    expect(pkg.scripts['verify:fuses']).toBe('node scripts/verify-fuses.mjs')
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

/** The text of one step of release.yml, from its `- name:` to the next step. */
const step = (name) => {
  const start = workflow.indexOf(`- name: ${name}`)
  expect(start).toBeGreaterThan(-1)
  const next = workflow.indexOf('\n      - ', start + 1)
  return workflow.slice(start, next === -1 ? undefined : next)
}

/**
 * Windows signing on a current JDK (HTOO-517). A fault here shows only on a
 * tag, which is the most expensive moment to find it, so the shape is pinned.
 * The comment on resolveJava in scripts/sign.js tells why the bundled JDK
 * cannot sign.
 *
 * This checks the request and the resolver, not a signed file. Only a tag run
 * with the ES_* secrets can sign.
 */
describe('Windows signing on a current JDK (HTOO-517)', () => {
  it('installs Temurin 17, then CodeSignTool, before the packaging step', () => {
    expect(step('Set up Java 17 for CodeSignTool')).toMatch(
      /uses: actions\/setup-java@v5\n\s+with:\n\s+distribution: temurin\n\s+java-version: '17'/
    )
    const order = [
      '- name: Set up Java 17 for CodeSignTool',
      '- name: Download CodeSignTool',
      '- name: Package installer + portable exe'
    ].map((name) => workflow.indexOf(name))
    expect(order).not.toContain(-1)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('never names CodeSignTool.bat or the bundled JDK', () => {
    // The .bat always runs the bundled JDK. The workflow finds the jar instead,
    // and the folder above jar/ becomes CODE_SIGN_TOOL_PATH.
    expect(workflow).not.toMatch(/CodeSignTool\.bat|jdk-11/)
    const download = step('Download CodeSignTool')
    expect(download).toContain("-Filter 'code_sign_tool-*.jar'")
    expect(download).toContain('$jar.Directory.Parent.FullName')
  })

  it('stops the download step on a bad layout or a missing Java, before the packaging', () => {
    // Without these stops, the fault shows minutes later inside electron-builder.
    const download = step('Download CodeSignTool')
    expect(download).toContain("$jars.Count -ne 1 -or $jars[0].Directory.Name -ne 'jar'")
    expect(download).toContain('-not (Test-Path $java)')
  })

  it('needs no Node 20 holdout', () => {
    // The env existed only for sslcom/esigner-codesign (`using: node20`).
    expect(workflow).not.toMatch(/^\s*FORCE_JAVASCRIPT_ACTIONS_TO_NODE24:/m)
  })

  describe('the java that scripts/sign.js runs', () => {
    const { resolveCodeSignTool, resolveJava } = createRequire(import.meta.url)('./sign.js')
    let root, toolDir, bundledJava, javaHome

    // A CodeSignTool folder with the v1.3.2 layout, and a separate JAVA_HOME.
    // Each java.exe is an empty file: the resolver only reads paths.
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'epona-sign-'))
      toolDir = join(root, 'CodeSignTool-v1.3.2')
      bundledJava = join(toolDir, 'jdk-11.0.2', 'bin', 'java.exe')
      mkdirSync(join(toolDir, 'jdk-11.0.2', 'bin'), { recursive: true })
      writeFileSync(bundledJava, '')
      mkdirSync(join(toolDir, 'jar'))
      writeFileSync(join(toolDir, 'jar', 'code_sign_tool-1.3.2.jar'), '')
      javaHome = join(root, 'temurin-17')
      mkdirSync(join(javaHome, 'bin'), { recursive: true })
      writeFileSync(join(javaHome, 'bin', 'java.exe'), '')
    })
    afterEach(() => rmSync(root, { recursive: true, force: true }))

    it('runs the jar on $JAVA_HOME/bin/java.exe, not on the bundled JDK', () => {
      const { java, jar } = resolveCodeSignTool(toolDir, { JAVA_HOME: javaHome }, 'win32')
      expect(java).toBe(join(javaHome, 'bin', 'java.exe'))
      expect(java).not.toBe(bundledJava)
      expect(jar).toBe(join(toolDir, 'jar', 'code_sign_tool-1.3.2.jar'))
    })

    it('falls back to the java on PATH, never to the bundled JDK', () => {
      // No JAVA_HOME, and a JAVA_HOME with no java in it.
      expect(resolveCodeSignTool(toolDir, {}, 'win32').java).toBe('java')
      expect(resolveJava({ JAVA_HOME: join(root, 'no-such-jdk') }, 'win32')).toBe('java')
    })
  })
})
