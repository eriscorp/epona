import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// The preload runs its exposeInMainWorld at import time, so the mock has to be
// in place first and the import has to be awaited rather than hoisted.
const exposed = []
const invoke = vi.fn().mockResolvedValue(undefined)
const send = vi.fn()
const on = vi.fn()
const removeListener = vi.fn()

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (key, api) => exposed.push([key, api]) },
  ipcRenderer: {
    invoke: (...a) => invoke(...a),
    send: (...a) => send(...a),
    on: (...a) => on(...a),
    removeListener: (...a) => removeListener(...a)
  }
}))

await import('./index.js')

const [[bridgeKey, api]] = exposed

beforeEach(() => {
  invoke.mockClear()
  send.mockClear()
  on.mockClear()
  removeListener.mockClear()
})

describe('the context bridge', () => {
  it('exposes exactly one bridge, named sparkAPI', () => {
    // Not the house-standard window.api. Renderer code reaches it through
    // diagnosticsBridge.js so the name stays in one place; a rename here is a
    // renderer-wide breaking change and should not pass quietly.
    expect(exposed).toHaveLength(1)
    expect(bridgeKey).toBe('sparkAPI')
  })

  it('exposes the platform string and otherwise only functions', () => {
    expect(api.platform).toBe(process.platform)
    for (const [key, value] of Object.entries(api)) {
      if (key === 'platform') continue
      expect(typeof value, `${key} should be a function`).toBe('function')
    }
  })

  it('never hands the renderer ipcRenderer or a raw channel caller', () => {
    // The bridge's whole value is that the renderer names an operation, not a
    // channel. Leaking invoke/send/on would make every main-process handler
    // reachable with an arbitrary channel string.
    const values = Object.values(api)
    expect(values).not.toContain(invoke)
    expect(values).not.toContain(send)
    expect(values).not.toContain(on)
    for (const key of ['invoke', 'send', 'on', 'ipcRenderer', 'require', 'process']) {
      expect(api[key]).toBeUndefined()
    }
  })
})

describe('every exposed method reaches IPC', () => {
  // Structural rather than per-channel: a method added to the bridge that
  // forwards nowhere, or forwards to an un-namespaced channel, fails here
  // without anyone remembering to add a case for it.
  const methods = Object.entries(api).filter(([k]) => k !== 'platform')

  it.each(methods)('%s forwards to a namespaced channel', (name, fn) => {
    fn(() => {})
    const calls = [...invoke.mock.calls, ...send.mock.calls, ...on.mock.calls]
    expect(calls.length, `${name} forwarded nothing`).toBeGreaterThan(0)
    for (const [channel] of calls) {
      expect(typeof channel).toBe('string')
      expect(channel, `${name} used a bare channel name`).toMatch(/^[a-z]+:[A-Za-z]+$/)
    }
  })
})

describe('subscription methods', () => {
  const subscribers = ['onHybrasylLog', 'onHybrasylChildExit', 'onInstanceStatus', 'onInstanceLog']

  it.each(subscribers)('%s unsubscribes the same listener it registered', (name) => {
    const unsubscribe = api[name](() => {})
    const [channel, listener] = on.mock.calls[0]

    expect(typeof unsubscribe).toBe('function')
    unsubscribe()

    // Passing a fresh closure to removeListener is the classic version of this
    // bug: it removes nothing, and every remount leaks another listener.
    expect(removeListener).toHaveBeenCalledWith(channel, listener)
  })

  it('unwraps the event argument so the renderer never sees the IpcRendererEvent', () => {
    const cb = vi.fn()
    api.onInstanceLog(cb)
    const [, listener] = on.mock.calls[0]
    listener({ sender: 'ipc-event-object' }, { instanceId: 'i1', line: 'hello' })
    expect(cb).toHaveBeenCalledWith({ instanceId: 'i1', line: 'hello' })
  })
})

describe('the sandbox constraint', () => {
  it('imports electron and nothing else', () => {
    // The main window runs sandbox: true, and a sandboxed preload's loader
    // resolves only `electron` plus a few Node built-ins. Any other import
    // builds and links fine, then throws in the packaged app and takes the
    // whole bridge with it. e2e/preload-sandbox.spec.js catches it against a
    // real build; this catches it in milliseconds, and on the POSIX CI job
    // where e2e does not run.
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.js'), 'utf-8')
    const imports = [...src.matchAll(/^\s*import\s+.*?from\s+'([^']+)'/gm)].map((m) => m[1])
    expect(imports).toEqual(['electron'])
    expect(src).not.toMatch(/\brequire\s*\(/)
  })
})
