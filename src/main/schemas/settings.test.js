import { describe, it, expect } from 'vitest'
import { settingsSchema } from './settings.js'

const VALID = {
  targetKind: 'legacy',
  clientPath: '',
  version: 'auto',
  skipIntro: true,
  multipleInstances: true,
  hideWalls: false,
  theme: 'hybrasyl',
  activeProfile: 'official',
  profiles: [
    {
      id: 'official',
      name: 'Dark Ages (Official)',
      hostname: 'da0.kru.com',
      port: 2610,
      redirect: false
    }
  ],
  instances: [],
  activeInstance: null,
  worldDirectories: [],
  activeWorldDirectory: null,
  targets: {
    hybrasyl: {
      mode: 'binary',
      binaryPath: '',
      clientRepoPath: '',
      clientBranch: null,
      autoSaveLogs: false
    }
  }
}

describe('settingsSchema', () => {
  it('accepts the default settings shape', () => {
    expect(() => settingsSchema.parse(VALID)).not.toThrow()
  })

  it('accepts a populated shape with one instance and world directory', () => {
    const populated = {
      ...VALID,
      worldDirectories: [{ id: 'wd1', name: 'ceridwen', path: 'C:/hyb/ceridwen' }],
      activeWorldDirectory: 'wd1',
      instances: [
        {
          id: 'i1',
          name: 'local',
          mode: 'repo',
          binaryPath: '',
          serverRepoPath: 'C:/hyb/server',
          serverBranch: 'main',
          xmlRepoPath: 'C:/hyb/xml',
          xmlBranch: null,
          worldDirectoryId: 'wd1',
          logDir: 'C:/hyb/logs',
          configFileName: 'local.xml',
          redisHost: '',
          redisPort: 6379,
          redisDatabase: null,
          redisPassword: '',
          lobbyPort: 2610,
          loginPort: 2611,
          worldPort: 2612
        }
      ],
      activeInstance: 'i1'
    }
    expect(() => settingsSchema.parse(populated)).not.toThrow()
  })

  it('rejects when theme is the wrong type', () => {
    expect(() => settingsSchema.parse({ ...VALID, theme: 42 })).toThrow()
  })

  it('rejects when profiles is not an array', () => {
    expect(() => settingsSchema.parse({ ...VALID, profiles: 'official' })).toThrow()
  })

  it("rejects an instance with mode outside the 'binary' | 'repo' enum", () => {
    const bad = {
      ...VALID,
      instances: [{ ...VALID.profiles[0], mode: 'foo' }]
    }
    expect(() => settingsSchema.parse(bad)).toThrow()
  })

  it('rejects an instance whose serverBranch is a number (must be string|null)', () => {
    const bad = {
      ...VALID,
      instances: [
        {
          id: 'i1',
          name: 'x',
          mode: 'binary',
          binaryPath: '',
          serverRepoPath: '',
          serverBranch: 42,
          xmlRepoPath: '',
          xmlBranch: null,
          worldDirectoryId: '',
          logDir: '',
          configFileName: '',
          redisHost: '',
          redisPort: 6379,
          redisDatabase: null,
          redisPassword: '',
          lobbyPort: 2610,
          loginPort: 2611,
          worldPort: 2612
        }
      ]
    }
    expect(() => settingsSchema.parse(bad)).toThrow()
  })

  it('strips unknown top-level fields silently', () => {
    const withExtra = { ...VALID, serverHostname: 'legacy.example.com' }
    const parsed = settingsSchema.parse(withExtra)
    expect(parsed).not.toHaveProperty('serverHostname')
    expect(parsed.theme).toBe('hybrasyl')
  })
})
