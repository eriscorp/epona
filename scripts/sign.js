// electron-builder sign hook — invoked once per signable Windows binary
// (the inner Epona.exe, resources/elevate.exe, the NSIS uninstaller, the
// installer wrapper and the portable self-extractor). Shells out to
// ssl.com's CodeSignTool to sign with the cert hosted in Cloud eSigner.
//
// This replaces the two post-hoc `sslcom/esigner-codesign` steps the
// release workflow used to run. Those signed only the two OUTER
// artifacts, so everything the portable exe unpacked into %TEMP% —
// Epona.exe, elevate.exe, da_win32.node — arrived unsigned inside a
// signed wrapper. An unsigned payload behind a self-extracting stub is
// one of the signals behind the Trojan:Win32/Wacatac.C!ml false positive
// documented in docs/antivirus.md.
//
// Skips silently when the ES_* env vars or CODE_SIGN_TOOL_PATH aren't
// set — keeps local `npm run build:win` working without ssl.com
// credentials. The release workflow passes the env vars in.
//
// Wired in via electron-builder.yml: `win.signtoolOptions.sign:
// scripts/sign.js`. electron-builder requires the script to export a
// function; using module.exports for plain CJS interop.

const { execFileSync } = require('node:child_process')
const { existsSync, mkdirSync, copyFileSync, rmSync, readdirSync } = require('node:fs')
const { join, basename, dirname } = require('node:path')

const REQUIRED_VARS = [
  'ES_USERNAME',
  'ES_PASSWORD',
  'ES_CREDENTIAL_ID',
  'ES_TOTP_SECRET',
  'CODE_SIGN_TOOL_PATH'
]

// True when every credential CodeSignTool needs is present. Callers use
// this to decide whether to announce a skip once rather than once per
// file.
function signingConfigured() {
  return REQUIRED_VARS.every((v) => process.env[v])
}

// Resolve the java + jar that CodeSignTool.bat would have run.
//
// We do NOT run the .bat. Two reasons, both load-bearing:
//
//  1. Node refuses to execFile a .bat/.cmd at all since the fix for
//     CVE-2024-27980 — it throws EINVAL. That is what broke the v2.7.2
//     release build ("spawnSync ...\CodeSignTool.bat EINVAL").
//  2. The obvious workaround, running it through `cmd.exe /c`, hands the
//     arguments to a shell. Verified locally: an `&` inside an argument
//     terminates the command and cmd tries to run the rest. ES_PASSWORD and
//     ES_TOTP_SECRET go through here, and a password containing & | ^ < >
//     would break the build in a way that leaks part of the secret into a
//     log line as a "not recognized as an internal or external command"
//     error. Not acceptable for a credential.
//
// java.exe is a real executable, so execFileSync passes argv straight through
// with no shell anywhere in the chain and any byte in a secret is safe.
//
// The .bat itself is a two-line wrapper (verified against v1.3.2):
//   %CODE_SIGN_TOOL_PATH%\jdk-11.0.2\bin\java -jar %CODE_SIGN_TOOL_PATH%\jar\code_sign_tool-1.3.2.jar %*
// so it ships its own JDK. Prefer that one; fall back to `java` on PATH if a
// future layout drops it, which is why the workflow still installs a JDK.
// Both the JDK directory and the jar carry version numbers, so glob rather
// than hardcode — a CodeSignTool bump should not need a code change here.
function resolveCodeSignTool(codeSignToolPath) {
  const entries = existsSync(codeSignToolPath) ? readdirSync(codeSignToolPath) : []

  const jdkDir = entries.find((e) => e.startsWith('jdk-'))
  const bundledJava = jdkDir ? join(codeSignToolPath, jdkDir, 'bin', 'java.exe') : null
  const java = bundledJava && existsSync(bundledJava) ? bundledJava : 'java'

  const jarDir = join(codeSignToolPath, 'jar')
  const jarName = existsSync(jarDir)
    ? readdirSync(jarDir).find((e) => e.startsWith('code_sign_tool-') && e.endsWith('.jar'))
    : null
  if (!jarName) {
    throw new Error(
      `[sign] no code_sign_tool-*.jar under ${jarDir} — check CODE_SIGN_TOOL_PATH (${codeSignToolPath})`
    )
  }

  return { java, jar: join(jarDir, jarName) }
}

// Sign one PE in place. Throws on any failure — a half-signed release is
// worse than a failed build, and the release workflow should stop.
//
// CodeSignTool writes the signed copy to an output directory rather than
// editing in place, so this signs into a scratch dir beside the input and
// then overwrites. outputDir lives next to the input, NOT in tmpdir():
// Windows tmpdir() can sit on a different volume than the build output,
// and cross-volume copies lose the same-volume atomicity relied on below.
function signFile(filePath) {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v])
  if (missing.length > 0) {
    console.log(`[sign] skipping ${basename(filePath)} — env not set (${missing.join(', ')})`)
    return false
  }

  const codeSignToolPath = process.env.CODE_SIGN_TOOL_PATH
  const { java, jar } = resolveCodeSignTool(codeSignToolPath)

  const outputDir = join(dirname(filePath), '.esigner-output')
  mkdirSync(outputDir, { recursive: true })

  console.log(`[sign] signing ${basename(filePath)} via ssl.com Cloud eSigner…`)

  try {
    execFileSync(
      java,
      [
        '-jar',
        jar,
        'sign',
        `-username=${process.env.ES_USERNAME}`,
        `-password=${process.env.ES_PASSWORD}`,
        `-credential_id=${process.env.ES_CREDENTIAL_ID}`,
        `-totp_secret=${process.env.ES_TOTP_SECRET}`,
        `-input_file_path=${filePath}`,
        // -output_dir_path is NOT optional in practice: without it CodeSignTool
        // prompts "The output signed file will replace the original file. Do you
        // still want to continue [y/n]?" on stdin. On a runner that waits until
        // the job times out. stdin is closed below so a future prompt fails fast
        // instead of hanging, but keep passing this.
        `-output_dir_path=${outputDir}`,
        '-override=true'
      ],
      // stdin closed deliberately — see above. stdout/stderr inherited so the
      // "Code signed successfully" line lands in the job log.
      { stdio: ['ignore', 'inherit', 'inherit'], cwd: codeSignToolPath }
    )
  } catch (err) {
    rmSync(outputDir, { recursive: true, force: true })
    throw new Error(`[sign] CodeSignTool failed for ${basename(filePath)}: ${err.message}`)
  }

  const signedPath = join(outputDir, basename(filePath))
  if (!existsSync(signedPath)) {
    rmSync(outputDir, { recursive: true, force: true })
    throw new Error(`[sign] CodeSignTool succeeded but no signed file emitted at ${signedPath}`)
  }

  // Overwrite the unsigned original with the signed copy. copyFileSync is
  // atomic on Windows for files on the same volume, so an interrupted
  // build leaves either the original or the fully-signed version, never a
  // torn write.
  copyFileSync(signedPath, filePath)
  rmSync(outputDir, { recursive: true, force: true })
  console.log(`[sign] signed ${basename(filePath)}`)
  return true
}

module.exports = async function sign(configuration) {
  signFile(configuration.path)
}

module.exports.signFile = signFile
module.exports.signingConfigured = signingConfigured
module.exports.REQUIRED_VARS = REQUIRED_VARS
