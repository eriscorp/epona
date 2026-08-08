import { lookup } from 'dns/promises'
import { createRequire } from 'module'
import { getVersion, detectVersion, supportsRuntimePatch } from '../clientVersions.js'
import { installGroundItemHints } from '../patches/installer.js'
import { describeLaunchError } from './launchError.js'

// Native addon must be loaded via require (CJS) — not bundled by Vite
const win32 = process.platform === 'win32' ? createRequire(import.meta.url)('da-win32') : null

// Resolve a profile hostname to an IPv4 address.
//
// `family: 4` is load-bearing, not a hint. The hostname patch below encodes the
// address as four raw bytes, so an IPv6 answer cannot be represented at all —
// and on a dual-stack machine `localhost` answers `::1` first, which is the
// common case rather than an exotic one. Without the family the split produced
// four NaNs, Buffer.from turned each into 0, and the launcher wrote 0.0.0.0
// into the suspended client and reported success. See HTOO-88.
export async function resolveIpv4(hostname) {
  const { address } = await lookup(hostname, { family: 4 })
  return address
}

// Encode a dotted-quad address as the client's hostname patch: each octet
// preceded by 0x6a (`push imm8`), in reverse order, because the client pushes
// the octets onto the stack and reads them back off it.
//
// Validates rather than trusting the caller. `resolveIpv4` should make a
// malformed address impossible, but the failure this guards is silent — a bad
// address produces a client that starts, connects to nothing, and gives the
// user no reason why. An exception here surfaces as a launch error instead.
export function encodeHostnamePatch(address) {
  // Match the digits before converting. `Number` is too permissive to validate
  // with: it reads '' as 0, so '127.0..1' would encode as 127.0.0.1, and it
  // reads '0x7f' as 127 and ' 1 ' as 1. Each of those is a wrong address that
  // encodes without complaint, which is the failure mode this whole function
  // exists to prevent.
  const parts = String(address).split('.')
  const valid = parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
  if (!valid) {
    throw new Error(
      `Cannot patch the client with "${address}" — the Legacy redirect needs an ` +
        `IPv4 address. Set the profile hostname to an IPv4 address such as 127.0.0.1.`
    )
  }
  const [a, b, c, d] = parts.map(Number)
  return Buffer.from([0x6a, d, 0x6a, c, 0x6a, b, 0x6a, a])
}

export async function launch(settings, profile) {
  if (!win32) return { success: false, error: 'Windows only' }

  const {
    clientPath,
    version: versionSetting,
    skipIntro,
    multipleInstances,
    hideWalls,
    groundItemHints
  } = settings

  // Resolve 'auto' by detecting from the exe, otherwise use the selected version code
  let versionCode = versionSetting
  if (versionSetting === 'auto') {
    const detected = await detectVersion(clientPath)
    if (!detected.found) return { success: false, error: 'Could not auto-detect client version' }
    versionCode = detected.versionCode
  }

  const version = getVersion(versionCode)
  if (!version) return { success: false, error: `Unknown version: ${versionCode}` }

  const { PROCESS_VM_READ, PROCESS_VM_WRITE, PROCESS_VM_OPERATION, PROCESS_QUERY_INFORMATION } =
    win32

  // The hook patch reads back everything it writes and has to resolve the
  // loaded module base, so it needs more than write access.
  const wantsHooks =
    Boolean(groundItemHints) && supportsRuntimePatch(versionCode, 'groundItemHints')

  let processHandle, threadHandle, memHandle
  // Set once the process is suspended: a failure after this point must kill it
  // rather than resume a half-patched client.
  let patchFailed = false

  try {
    // 1. Create suspended process
    const proc = win32.createSuspendedProcess(clientPath)
    processHandle = proc.processHandle
    threadHandle = proc.threadHandle

    // 2. Open for memory write
    memHandle = win32.openProcess(
      proc.processId,
      PROCESS_VM_WRITE |
        PROCESS_VM_OPERATION |
        (wantsHooks ? PROCESS_VM_READ | PROCESS_QUERY_INFORMATION : 0)
    )

    // 3. Apply patches
    if (profile.redirect && profile.hostname) {
      const address = await resolveIpv4(profile.hostname)
      win32.writeProcessMemory(
        memHandle,
        version.hostnamePatchAddress,
        encodeHostnamePatch(address)
      )

      if (version.skipHostnamePatchAddress !== null) {
        win32.writeProcessMemory(
          memHandle,
          version.skipHostnamePatchAddress,
          Buffer.alloc(13, 0x90)
        )
      }

      const portBytes = Buffer.from([profile.port & 0xff, (profile.port >> 8) & 0xff])
      win32.writeProcessMemory(memHandle, version.portPatchAddress, portBytes)
    }

    if (skipIntro) {
      win32.writeProcessMemory(
        memHandle,
        version.skipIntroPatchAddress,
        Buffer.from([0x83, 0xfa, 0x00, 0x90, 0x90, 0x90])
      )
    }

    if (multipleInstances) {
      win32.writeProcessMemory(
        memHandle,
        version.multipleInstancesPatchAddress,
        Buffer.from([0x31, 0xc0, 0x90, 0x90, 0x90, 0x90])
      )
    }

    if (hideWalls) {
      win32.writeProcessMemory(
        memHandle,
        version.hideWallsPatchAddress,
        Buffer.from([0xeb, 0x17, 0x90])
      )
    }

    // Ground-item hints. Unlike the pokes above this installs code, so it
    // verifies every byte it is about to displace first and undoes everything
    // if any step fails. A failure here is fatal to the launch: we must not
    // resume a client we may have half-patched.
    if (wantsHooks) {
      // Resolve where the image actually landed rather than assuming the
      // preferred base — the stub relocations are all module-base relative.
      const moduleBase = win32.getMainModuleBase(memHandle)
      installGroundItemHints({ mem: win32, handle: memHandle, moduleBase })
    }

    return { success: true }
  } catch (err) {
    // Fail closed for EVERY patch failure, not only a hook rollback. This flag
    // used to be set inside the ground-item-hints block alone, so a throw from
    // any other step fell through to resumeThreadFully below and started a
    // client we had partly rewritten. A DNS failure or a non-IPv4 address now
    // lands here too. If the throw came from createSuspendedProcess itself
    // there is no thread handle and the finally does nothing, so setting this
    // unconditionally is safe.
    patchFailed = true
    return { success: false, error: describeLaunchError(err, clientPath) }
  } finally {
    if (memHandle) win32.closeHandle(memHandle)
    if (threadHandle) {
      // A client we may have half-patched gets killed, not resumed. The hook
      // installer rolls its own writes back, but the appendix is explicit that
      // a partially patched process must never run.
      if (patchFailed && processHandle) {
        try {
          win32.terminateProcess(processHandle, 1)
        } catch {
          /* the process may already be gone */
        }
      } else {
        win32.resumeThreadFully(threadHandle)
      }
      win32.closeHandle(threadHandle)
    }
    if (processHandle) win32.closeHandle(processHandle)
  }
}
