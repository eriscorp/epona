import { z } from 'zod'

// Validation at the IPC boundary for the Dark Ages install flow.
//
// These payloads become filesystem paths that the main process reads from and
// writes a 582 MiB tree into, which is exactly the sort of thing that should not
// be taken on trust from the renderer. The renderer only ever sends paths it got
// back from a native dialog, so anything else is either a bug or something worse,
// and both deserve the same flat refusal.
//
// Non-empty strings, and nothing else. Whether a path is a real installer or a
// writable folder is not a question a schema can answer — daInstaller does that,
// and gives a reason when the answer is no.

const requiredPath = z.string().min(1)

export const installRequestSchema = z.object({
  installerPath: requiredPath,
  destinationDir: requiredPath
})

export const downloadRequestSchema = z.object({
  destinationDir: requiredPath
})
