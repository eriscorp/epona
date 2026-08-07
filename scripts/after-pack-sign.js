// afterPack hook — Authenticode-sign the native addon.
//
// WHY THIS EXISTS SEPARATELY FROM scripts/sign.js
//
// electron-builder's `win.signtoolOptions.sign` hook is only invoked for
// the binaries electron-builder itself considers signable: Epona.exe,
// resources/elevate.exe, the NSIS uninstaller, and the two outer
// artifacts. It never walks asarUnpack'd files, so da_win32.node is
// missed — and that is the one binary in the payload whose import table
// reads like malware: CreateProcessA(CREATE_SUSPENDED), OpenProcess,
// VirtualAllocEx, WriteProcessMemory, VirtualProtectEx(PAGE_EXECUTE_*),
// FlushInstructionCache, ResumeThread, plus a dynamically resolved
// NtQueryInformationProcess. Those are exactly what Epona needs to patch
// the legacy client, and exactly what a heuristic scores on. Leaving the
// single most suspicious file in the tree as the single unsigned file in
// the tree is the worst of both worlds. See docs/antivirus.md.
//
// THE .node EXTENSION DANCE
//
// A .node addon is a PE/DLL with a different extension. CodeSignTool
// dispatches on extension and does not recognise .node, so this signs a
// .dll-named copy and writes the signed bytes back. That is safe: an
// Authenticode signature lives in the PE certificate table, which the
// loader reads from the header — the filename plays no part in it.
//
// Runs on Windows only. The macOS and Linux jobs pass
// --config.beforeBuild=scripts/noop-before-build.cjs to skip the addon
// rebuild, and on those platforms the addon compiles to an empty stub.

const { existsSync, readdirSync, copyFileSync, rmSync } = require('node:fs')
const { join, extname } = require('node:path')

const { signFile, signingConfigured } = require('./sign.js')

// Recursively collect .node addons under a directory. The packed tree can
// hold more than one: `packages/da-win32/build/**` and
// `node_modules/da-win32/build/**` are both asarUnpack'd, and npm links
// the workspace member into node_modules.
function findNodeAddons(dir, found = []) {
  if (!existsSync(dir)) return found
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) findNodeAddons(full, found)
    else if (entry.isFile() && extname(entry.name) === '.node') found.push(full)
  }
  return found
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const unpacked = join(context.appOutDir, 'resources', 'app.asar.unpacked')
  const addons = findNodeAddons(unpacked)

  if (addons.length === 0) {
    // Not fatal on its own, but it means asarUnpack or the files
    // allowlist moved and the Legacy tab is probably broken anyway.
    console.log('[sign] no .node addons found under app.asar.unpacked — nothing to sign')
    return
  }

  if (!signingConfigured()) {
    console.log(
      `[sign] skipping ${addons.length} native addon(s) — ES_*/CODE_SIGN_TOOL_PATH not set`
    )
    return
  }

  for (const addon of addons) {
    // Sign a .dll-named sibling, then copy the signed bytes back over the
    // .node. Same directory, so the copy stays on one volume.
    const asDll = `${addon}.dll`
    copyFileSync(addon, asDll)
    try {
      signFile(asDll)
      copyFileSync(asDll, addon)
    } finally {
      rmSync(asDll, { force: true })
    }
  }

  console.log(`[sign] signed ${addons.length} native addon(s)`)
}
