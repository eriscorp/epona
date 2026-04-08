import { lookup } from 'dns/promises'
import { createRequire } from 'module'
import { getVersion, detectVersion } from './clientVersions.js'

// Native addon must be loaded via require (CJS) — not bundled by Vite
const win32 =
  process.platform === 'win32'
    ? createRequire(import.meta.url)('da-win32')
    : null

export async function launch(settings) {
  if (!win32) return { success: false, error: 'Windows only' }

  const {
    clientPath,
    version: versionSetting,
    redirectServer,
    serverHostname,
    serverPort,
    skipIntro,
    multipleInstances,
    hideWalls
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

  const { PROCESS_VM_WRITE, PROCESS_VM_OPERATION } = win32

  let processHandle, threadHandle, memHandle

  try {
    // 1. Create suspended process
    const proc = win32.createSuspendedProcess(clientPath)
    processHandle = proc.processHandle
    threadHandle = proc.threadHandle

    // 2. Open for memory write
    memHandle = win32.openProcess(proc.processId, PROCESS_VM_WRITE | PROCESS_VM_OPERATION)

    // 3. Apply patches
    if (redirectServer && serverHostname) {
      const { address } = await lookup(serverHostname)
      const ip = address.split('.').map(Number)
      const hostnameBytes = Buffer.from([
        0x6a, ip[3], 0x6a, ip[2], 0x6a, ip[1], 0x6a, ip[0]
      ])
      win32.writeProcessMemory(memHandle, version.hostnamePatchAddress, hostnameBytes)

      if (version.skipHostnamePatchAddress !== null) {
        win32.writeProcessMemory(
          memHandle,
          version.skipHostnamePatchAddress,
          Buffer.alloc(13, 0x90)
        )
      }

      const port = serverPort
      const portBytes = Buffer.from([port & 0xff, (port >> 8) & 0xff])
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

    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  } finally {
    if (memHandle) win32.closeHandle(memHandle)
    if (threadHandle) {
      win32.resumeThreadFully(threadHandle)
      win32.closeHandle(threadHandle)
    }
    if (processHandle) win32.closeHandle(processHandle)
  }
}
