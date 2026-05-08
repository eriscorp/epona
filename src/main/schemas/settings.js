import { z } from 'zod'

// Mirrors the settings shape owned by settingsManager.js. Default .object()
// strips unknown extras — we deliberately do NOT use .strict() because the
// migration layer (migrateProfiles, migrateHybrasylTarget, etc.) drops legacy
// fields like `serverHostname`, `dataDir`, `targets.chaos` over the course of
// a few saves. Strict would reject them as false positives. The schema's job
// here is to refuse type-shape disasters; withDefaults() handles coercion of
// present-but-wrong-typed fields on the load side.

const profileSchema = z.object({
  id: z.string(),
  name: z.string(),
  hostname: z.string(),
  port: z.number(),
  redirect: z.boolean()
})

const instanceSchema = z.object({
  id: z.string(),
  name: z.string(),
  mode: z.enum(['binary', 'repo']),
  binaryPath: z.string(),
  serverRepoPath: z.string(),
  serverBranch: z.string().nullable(),
  xmlRepoPath: z.string(),
  xmlBranch: z.string().nullable(),
  worldDirectoryId: z.string(),
  logDir: z.string(),
  configFileName: z.string(),
  redisHost: z.string(),
  redisPort: z.number(),
  redisDatabase: z.number().nullable(),
  redisPassword: z.string(),
  lobbyPort: z.number(),
  loginPort: z.number(),
  worldPort: z.number()
})

const worldDirectorySchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string()
})

const hybrasylTargetSchema = z.object({
  mode: z.enum(['binary', 'repo']),
  binaryPath: z.string(),
  clientRepoPath: z.string(),
  clientBranch: z.string().nullable(),
  autoSaveLogs: z.boolean()
})

export const settingsSchema = z.object({
  targetKind: z.string(),
  clientPath: z.string(),
  version: z.string(),
  skipIntro: z.boolean(),
  multipleInstances: z.boolean(),
  hideWalls: z.boolean(),
  theme: z.string(),
  activeProfile: z.string(),
  profiles: z.array(profileSchema),
  instances: z.array(instanceSchema),
  activeInstance: z.string().nullable(),
  worldDirectories: z.array(worldDirectorySchema),
  activeWorldDirectory: z.string().nullable(),
  targets: z.object({
    hybrasyl: hybrasylTargetSchema
  })
})
