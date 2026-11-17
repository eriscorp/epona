import { readdirSync, readFileSync } from 'fs'
import { dirname, join, relative } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import { APPIMAGE_RUNTIME_KEYS, childEnv, stripAppImageEnv } from './childEnv.js'

// HTOO-661. APPDIR is the FUSE mount; the lists are what AppRun makes of a
// desktop session's own values (app-builder-lib appImageUtil.js).
const APPDIR = '/tmp/.mount_EponaAb12Cd'
const APPIMAGE_ENV = {
  APPDIR,
  APPIMAGE: '/home/me/Applications/Epona-2.10.0.AppImage',
  ARGV0: '/home/me/Applications/Epona-2.10.0.AppImage',
  OWD: '/home/me',
  PATH: `${APPDIR}:${APPDIR}/usr/sbin:/usr/local/bin:/usr/bin:/bin`,
  XDG_DATA_DIRS: `${APPDIR}/usr/share/:/usr/share/ubuntu:/usr/share:/usr/share/gnome:/usr/local/share/:/usr/share/`,
  LD_LIBRARY_PATH: `${APPDIR}/usr/lib`,
  GSETTINGS_SCHEMA_DIR: `${APPDIR}/usr/share/glib-2.0/schemas`,
  HOME: '/home/me',
  DOTNET_ROOT: '/usr/lib/dotnet'
}

describe('stripAppImageEnv', () => {
  it('removes the entries AppRun put in front, and keeps the order of the rest', () => {
    const env = stripAppImageEnv(APPIMAGE_ENV)
    expect(env.PATH).toBe('/usr/local/bin:/usr/bin:/bin')
    expect(env.XDG_DATA_DIRS).toBe(
      '/usr/share/ubuntu:/usr/share:/usr/share/gnome:/usr/local/share/:/usr/share/'
    )
  })

  it('does not set a list that holds only AppRun entries', () => {
    const env = stripAppImageEnv(APPIMAGE_ENV)
    expect(env).not.toHaveProperty('LD_LIBRARY_PATH')
    expect(env).not.toHaveProperty('GSETTINGS_SCHEMA_DIR')
  })

  it('keeps a value the user set before AppRun', () => {
    const env = stripAppImageEnv({
      ...APPIMAGE_ENV,
      LD_LIBRARY_PATH: `${APPDIR}/usr/lib:/opt/mylibs`
    })
    expect(env.LD_LIBRARY_PATH).toBe('/opt/mylibs')
  })

  it('removes the runtime variables, and keeps the others', () => {
    const env = stripAppImageEnv(APPIMAGE_ENV)
    for (const key of APPIMAGE_RUNTIME_KEYS) expect(env).not.toHaveProperty(key)
    expect(env.HOME).toBe('/home/me')
    expect(env.DOTNET_ROOT).toBe('/usr/lib/dotnet')
  })

  it('removes only entries under APPDIR, not a path that starts with the same text', () => {
    const env = stripAppImageEnv({ ...APPIMAGE_ENV, PATH: `${APPDIR}:${APPDIR}-other/bin:/bin` })
    expect(env.PATH).toBe(`${APPDIR}-other/bin:/bin`)
  })

  it('accepts an APPDIR with a trailing slash', () => {
    const env = stripAppImageEnv({ ...APPIMAGE_ENV, APPDIR: `${APPDIR}/` })
    expect(env.PATH).toBe('/usr/local/bin:/usr/bin:/bin')
  })

  it('changes nothing outside an AppImage, and does not change its input', () => {
    const plain = { PATH: '/usr/bin:/bin', LD_LIBRARY_PATH: '/opt/x', HOME: '/home/me' }
    expect(stripAppImageEnv(plain)).toEqual(plain)
    // APPDIR alone (a session that inherited it) is not an AppImage launch.
    const appDirOnly = { ...plain, APPDIR }
    expect(stripAppImageEnv(appDirOnly)).toEqual(appDirOnly)
    const input = { ...APPIMAGE_ENV }
    stripAppImageEnv(input)
    expect(input).toEqual(APPIMAGE_ENV)
  })
})

describe('childEnv', () => {
  it('puts extra on top of the stripped environment', () => {
    const env = childEnv({ DA_NO_LAUNCHER: '1', PATH: '/custom' }, APPIMAGE_ENV)
    expect(env.DA_NO_LAUNCHER).toBe('1')
    expect(env.PATH).toBe('/custom')
    expect(env).not.toHaveProperty('APPIMAGE')
  })

  it('reads process.env by default', () => {
    expect(childEnv().PATH ?? childEnv().Path).toBe(process.env.PATH ?? process.env.Path)
  })
})

// Each child gets childEnv. A new spawn that leaves out `env` inherits the
// AppImage's variables again, and nothing else would show it: the fault is
// only on a Linux AppImage, after Epona exits.
describe('every spawn in src/main passes childEnv (HTOO-661)', () => {
  const MAIN = dirname(fileURLToPath(import.meta.url))

  function sources(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return sources(path)
      return /\.js$/.test(entry.name) && !/\.test\.js$/.test(entry.name) ? [path] : []
    })
  }

  // The text of the call that starts at `start`, to its closing parenthesis.
  // Strings and template literals are skipped, so a parenthesis in one does not count.
  function callText(src, start) {
    let depth = 0
    for (let i = src.indexOf('(', start); i < src.length; i++) {
      const c = src[i]
      if (c === "'" || c === '"' || c === '`') {
        i = src.indexOf(c, i + 1)
        continue
      }
      if (c === '(') depth++
      else if (c === ')' && --depth === 0) return src.slice(start, i + 1)
    }
    throw new Error(`unclosed call at ${start}`)
  }

  const calls = sources(MAIN).flatMap((file) => {
    const src = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n')
    return [
      ...src.matchAll(
        /(?<![.\w$])(spawn|spawnSync|execFile|execFileSync|execFileAsync|exec|execSync|fork)\(/g
      )
    ].map((m) => ({
      where: `${relative(MAIN, file)}: ${m[1]}`,
      text: callText(src, m.index),
      // A call may pass `env` as a shorthand for a variable that childEnv built.
      envIsChildEnv: /\bconst env = childEnv\(/.test(src)
    }))
  })

  it('finds the spawns', () => {
    // Guard the guard: git, the dotnet probes, the client, both server paths,
    // the kills and the port probe.
    expect(calls.length).toBeGreaterThanOrEqual(10)
  })

  it.each(calls.map((c) => [c.where, c]))('%s', (_where, { text, envIsChildEnv }) => {
    const direct = /\benv: childEnv\(/.test(text)
    const shorthand = envIsChildEnv && /^\s*env,?\s*$/m.test(text)
    expect(direct || shorthand, text).toBe(true)
  })
})
