import { create } from 'zustand'

// Ephemeral, high-frequency runtime state — the live log streams for the
// Hybrasyl client and each server instance. Kept in its own store (separate
// from settings) so a burst of log lines re-renders only the LogPane that
// subscribes to that slice, not the whole app tree.

export const LOG_CAP = 2000

// Append one record, capping the buffer so a chatty server can't grow it
// unbounded. Returns a new array (immutable update for the selector).
function appendCapped(arr, entry) {
  const next = arr.concat(entry)
  return next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next
}

export const useRuntime = create((set) => ({
  hybrasylLog: [],
  instanceLogs: {}, // { [instanceId]: [{ stream, text }] }

  appendHybrasyl: (stream, text) =>
    set((s) => ({ hybrasylLog: appendCapped(s.hybrasylLog, { stream, text }) })),
  clearHybrasyl: () => set({ hybrasylLog: [] }),

  appendInstance: (instanceId, stream, text) =>
    set((s) => ({
      instanceLogs: {
        ...s.instanceLogs,
        [instanceId]: appendCapped(s.instanceLogs[instanceId] ?? [], { stream, text })
      }
    })),
  clearInstance: (instanceId) =>
    set((s) => ({ instanceLogs: { ...s.instanceLogs, [instanceId]: [] } }))
}))
