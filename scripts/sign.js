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
const { existsSync, mkdirSync, copyFileSync, rmSync } = require('node:fs')
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
  const codeSignToolBat = join(codeSignToolPath, 'CodeSignTool.bat')
  if (!existsSync(codeSignToolBat)) {
    throw new Error(
      `[sign] CodeSignTool.bat not found at ${codeSignToolBat} — check CODE_SIGN_TOOL_PATH`
    )
  }

  const outputDir = join(dirname(filePath), '.esigner-output')
  mkdirSync(outputDir, { recursive: true })

  console.log(`[sign] signing ${basename(filePath)} via ssl.com Cloud eSigner…`)

  try {
    execFileSync(
      codeSignToolBat,
      [
        'sign',
        `-username=${process.env.ES_USERNAME}`,
        `-password=${process.env.ES_PASSWORD}`,
        `-credential_id=${process.env.ES_CREDENTIAL_ID}`,
        `-totp_secret=${process.env.ES_TOTP_SECRET}`,
        `-input_file_path=${filePath}`,
        `-output_dir_path=${outputDir}`,
        '-override=true'
      ],
      { stdio: 'inherit', cwd: codeSignToolPath }
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
