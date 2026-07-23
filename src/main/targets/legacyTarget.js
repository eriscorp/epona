import { lookup } from 'dns/promises'
import { createRequire } from 'module'
import { getVersion, detectVersion, supportsRuntimePatch } from '../clientVersions.js'
import { installGroundItemHints } from '../patches/installer.js'
import { describeLaunchError } from './launchError.js'

// Native addon must be loaded via require (CJS) — not bundled by Vite
const win32 = process.platform === 'win32' ? createRequire(import.meta.url)('da-win32') : null

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
      const { address } = await lookup(profile.hostname)
      const ip = address.split('.').map(Number)
      const hostnameBytes = Buffer.from([0x6a, ip[3], 0x6a, ip[2], 0x6a, ip[1], 0x6a, ip[0]])
      win32.writeProcessMemory(memHandle, version.hostnamePatchAddress, hostnameBytes)

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
      try {
        installGroundItemHints({ mem: win32, handle: memHandle, moduleBase })
      } catch (err) {
        patchFailed = true
        throw err
      }
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: describeLaunchError(err, clientPath) }
  } finally {
    if (memHandle) win32.closeHandle(memHandle)
    if (threadHandle) {
      // Fail closed: a client whose hook installation blew up gets killed, not
      // resumed. The installer rolls its own writes back, but the appendix is
      // explicit that a partially patched process must never run.
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
