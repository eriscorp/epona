import { useState, useEffect, forwardRef } from 'react'
import { ThemeProvider, CssBaseline, GlobalStyles, alpha, Tooltip } from '@mui/material'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Alert from '@mui/material/Alert'
import hybrasylTheme from './themes/hybrasyl'
import chadulTheme from './themes/chadul'
import danaanTheme from './themes/danaan'
import grinnealTheme from './themes/grinneal'
import sparkTheme from './themes/spark'
import TitleBar from './components/TitleBar'
import NavToolbar from './components/NavToolbar'
import ProfileSelector from './components/ProfileSelector'
import OptionsPanel from './components/OptionsPanel'
import HybrasylClientPanel from './components/HybrasylClientPanel'
import ServerInstancePanel from './components/ServerInstancePanel'
import ActionButtons from './components/ActionButtons'
import SettingsPane from './components/SettingsPane'
import LogPane from './components/LogPane'
import HelpDialog from './components/HelpDialog'

const TAB_ORDER = ['legacy', 'hybrasyl', 'server']
const kindToIndex = (k) => {
  const i = TAB_ORDER.indexOf(k)
  return i >= 0 ? i : 0
}

// Which tab to open on startup. The Legacy client is Windows-only (it patches
// the running Dark Ages.exe via native Win32 APIs), so never land a non-Windows
// user on it — fall back to the Hybrasyl client tab.
const startupTabIndex = (targetKind, isWindows) => {
  const i = kindToIndex(targetKind)
  if (!isWindows && TAB_ORDER[i] === 'legacy') return kindToIndex('hybrasyl')
  return i
}

// The disabled Legacy tab on non-Windows, with a hover tooltip. A disabled
// element doesn't fire pointer events, so the tooltip anchors on a span wrapper;
// the props <Tabs> injects into its children (value/selected/onChange/etc.) are
// forwarded to the real Tab rather than spread onto the span (which would warn
// about unknown DOM attributes).
const LegacyTabDisabled = forwardRef(function LegacyTabDisabled(props, ref) {
  return (
    <Tooltip title="Legacy client is only supported on Windows">
      <Box component="span" sx={{ flexGrow: 1, display: 'flex' }}>
        <Tab {...props} ref={ref} disabled sx={{ flexGrow: 1 }} />
      </Box>
    </Tooltip>
  )
})

const MAIN_W = 480
const PANE_W = 360
const WINDOW_H = 800
const LOG_CAP = 2000

const themes = {
  hybrasyl: hybrasylTheme,
  chadul: chadulTheme,
  danaan: danaanTheme,
  grinneal: grinnealTheme,
  spark: sparkTheme
}

const defaultSettings = {
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
  targets: {
    hybrasyl: {
      mode: 'binary',
      binaryPath: '',
      clientRepoPath: '',
      clientBranch: null,
      autoSaveLogs: false
    }
  },
  instances: [],
  activeInstance: null,
  worldDirectories: [],
  activeWorldDirectory: null
}

export default function App() {
  const isWindows = window.sparkAPI.platform === 'win32'
  const [settings, setSettings] = useState(defaultSettings)
  const [versions, setVersions] = useState([])
  const [detectedVersion, setDetectedVersion] = useState(null)
  const [themeName, setThemeName] = useState('hybrasyl')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [activeTab, setActiveTab] = useState(() =>
    startupTabIndex(defaultSettings.targetKind, window.sparkAPI.platform === 'win32')
  )
  const [logPaneOpen, setLogPaneOpen] = useState(false)
  const [hybrasylLog, setHybrasylLog] = useState([])
  const [instanceLogs, setInstanceLogs] = useState({}) // { [instanceId]: [{stream, text}, ...] }
  const [runningInstances, setRunningInstances] = useState(new Set())

  useEffect(() => {
    window.sparkAPI.loadSettings().then((s) => {
      setSettings((prev) => ({ ...prev, ...s }))
      if (s.theme && themes[s.theme]) setThemeName(s.theme)
      if (s.targetKind) setActiveTab(startupTabIndex(s.targetKind, isWindows))
      if (s.clientPath) {
        window.sparkAPI.detectVersion(s.clientPath).then((result) => {
          setDetectedVersion(result.found ? result.name : null)
        })
      }
    })
    window.sparkAPI.listVersions().then(setVersions)
  }, [])

  useEffect(() => {
    const offLog = window.sparkAPI.onHybrasylLog(({ stream, line }) => {
      setHybrasylLog((prev) => {
        const next = prev.concat({ stream, text: line })
        return next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next
      })
    })
    const offExit = window.sparkAPI.onHybrasylChildExit(({ pid, code, signal }) => {
      const label = signal ? `signal ${signal}` : `exit code ${code}`
      setHybrasylLog((prev) =>
        prev.concat({ stream: 'exit', text: `— process ${pid} ended (${label}) —` })
      )
    })
    const offInstanceLog = window.sparkAPI.onInstanceLog(({ instanceId, stream, line }) => {
      setInstanceLogs((prev) => {
        const prior = prev[instanceId] ?? []
        const next = prior.concat({ stream, text: line })
        const trimmed = next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next
        return { ...prev, [instanceId]: trimmed }
      })
    })
    const offInstanceExit = window.sparkAPI.onInstanceChildExit(
      ({ instanceId, pid, code, signal }) => {
        const label = signal ? `signal ${signal}` : `exit code ${code}`
        setInstanceLogs((prev) => {
          const prior = prev[instanceId] ?? []
          return {
            ...prev,
            [instanceId]: prior.concat({
              stream: 'exit',
              text: `— process ${pid} ended (${label}) —`
            })
          }
        })
        setRunningInstances((prev) => {
          const next = new Set(prev)
          next.delete(instanceId)
          return next
        })
      }
    )
    return () => {
      offLog?.()
      offExit?.()
      offInstanceLog?.()
      offInstanceExit?.()
    }
  }, [])

  useEffect(() => {
    const width = MAIN_W + (settingsOpen ? PANE_W : 0) + (logPaneOpen ? PANE_W : 0)
    window.sparkAPI.resizeWindow(width, WINDOW_H)
  }, [logPaneOpen, settingsOpen])

  function update(patch) {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      // Fire-and-forget save: log on failure so it isn't silent.
      window.sparkAPI
        .saveSettings(next)
        .catch((err) => console.error('[settings] saveSettings rejected:', err))
      if (patch.theme && themes[patch.theme]) setThemeName(patch.theme)
      return next
    })

    if (patch.clientPath !== undefined) {
      if (patch.clientPath) {
        window.sparkAPI.detectVersion(patch.clientPath).then((result) => {
          setDetectedVersion(result.found ? result.name : null)
        })
      } else {
        setDetectedVersion(null)
      }
    }
  }

  function getActiveProfile() {
    return settings.profiles.find((p) => p.id === settings.activeProfile) || settings.profiles[0]
  }

  async function handleLocateClient() {
    // Windows: pick the Dark Ages.exe (also the legacy memory-patch target).
    // macOS/Linux: there's no .exe to run — point Epona at the DA assets folder,
    // which is all the Hybrasyl client needs (DA_ASSET_PATH).
    const path = isWindows
      ? await window.sparkAPI.openExeDialog(settings.clientPath)
      : await window.sparkAPI.pickDirectory(
          'Select Dark Ages assets folder',
          settings.clientPath,
          'Choose the folder containing your Dark Ages assets (the install directory with its .dat files).'
        )
    if (path) update({ clientPath: path })
  }

  // Format buffered log lines and ship to main for a save dialog. The slug
  // becomes the leading filename component; main appends a timestamp + .log.
  // Stream tagging (stderr/exit) is preserved in the saved text so the file
  // is meaningful when opened away from this UI.
  async function saveLogToFile(lines, slug) {
    if (!lines || lines.length === 0) return
    const formatted = lines
      .map(({ stream, text }) => {
        if (stream === 'stderr') return `[stderr] ${text}`
        if (stream === 'exit') return `[exit] ${text}`
        return text
      })
      .join('\n')
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    const result = await window.sparkAPI.saveLog(formatted, `${slug}-${ts}.log`)
    if (result && !result.ok && !result.canceled) {
      console.error('[log] save failed:', result.error)
    }
  }

  const currentTheme = themes[themeName] || hybrasylTheme

  return (
    <ThemeProvider theme={currentTheme}>
      <CssBaseline />
      <GlobalStyles
        styles={(theme) => ({
          '::-webkit-scrollbar': { width: 16, height: 12 },
          '::-webkit-scrollbar-track': {
            background: alpha(theme.palette.background.default, 0.4),
            borderLeft: '8px solid transparent',
            backgroundClip: 'padding-box'
          },
          '::-webkit-scrollbar-thumb': {
            backgroundColor: alpha(theme.palette.primary.main, 0.5),
            borderRadius: 6,
            borderLeft: '8px solid transparent',
            backgroundClip: 'padding-box'
          },
          '::-webkit-scrollbar-thumb:hover': {
            backgroundColor: alpha(theme.palette.primary.main, 0.8)
          },
          '::-webkit-scrollbar-corner': { background: 'transparent' }
        })}
      />
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'row',
          width: '100%',
          height: WINDOW_H,
          bgcolor: 'background.default'
        }}
      >
        <Box
          sx={{
            flex: `0 0 ${MAIN_W}px`,
            height: WINDOW_H,
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'background.default',
            overflow: 'hidden'
          }}
        >
          <TitleBar />
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.15)' }} />
          <NavToolbar
            detectedVersion={detectedVersion}
            clientPath={settings.clientPath}
            onLocateClient={handleLocateClient}
            onToggleSettings={() => setSettingsOpen((o) => !o)}
            onOpenHelp={() => setHelpOpen(true)}
          />
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.15)' }} />

          <Tabs
            value={activeTab}
            onChange={(_, v) => {
              setActiveTab(v)
              update({ targetKind: TAB_ORDER[v] })
            }}
            variant="fullWidth"
            sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, textTransform: 'none' } }}
          >
            {isWindows ? (
              <Tab value={0} label="Legacy Client" />
            ) : (
              <LegacyTabDisabled value={0} label="Legacy Client" />
            )}
            <Tab value={1} label="Hybrasyl Client" />
            <Tab value={2} label="Hybrasyl Server" />
          </Tabs>
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.15)' }} />

          {activeTab === 0 && (
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, p: 2 }}>
              {window.sparkAPI.platform !== 'win32' && (
                <Alert severity="warning" variant="outlined">
                  Legacy Client requires Windows — it patches the running .exe via native Win32
                  APIs. On macOS or Linux you&apos;ll need a compatibility layer (Wine, CrossOver,
                  etc.) and we can&apos;t promise it&apos;ll work.
                </Alert>
              )}
              <ProfileSelector
                profiles={settings.profiles}
                activeProfile={settings.activeProfile}
                onChange={(id) => update({ activeProfile: id })}
              />
              <OptionsPanel settings={settings} onChange={update} />
              <ActionButtons
                targetKind="legacy"
                settings={settings}
                getActiveProfile={getActiveProfile}
              />
            </Box>
          )}

          {activeTab === 1 && (
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, p: 2 }}>
              <HybrasylClientPanel
                hybrasyl={settings.targets.hybrasyl}
                onChange={update}
                logPaneOpen={logPaneOpen}
                onToggleLogPane={() => setLogPaneOpen((o) => !o)}
                activeInstanceLogDir={
                  settings.instances.find((i) => i.id === settings.activeInstance)?.logDir || ''
                }
              />
              <ProfileSelector
                profiles={settings.profiles}
                activeProfile={settings.activeProfile}
                onChange={(id) => update({ activeProfile: id })}
              />
              <ActionButtons
                targetKind="hybrasyl"
                settings={settings}
                getActiveProfile={getActiveProfile}
              />
            </Box>
          )}

          {activeTab === 2 && (
            <Box
              sx={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
                p: 2,
                overflow: 'hidden'
              }}
            >
              <ServerInstancePanel
                instances={settings.instances}
                selectedId={settings.activeInstance}
                runningIds={runningInstances}
                worldDirectories={settings.worldDirectories}
                activeWorldDirectory={settings.activeWorldDirectory}
                onOpenSettings={() => setSettingsOpen(true)}
                onSelect={(id) => update({ activeInstance: id })}
                onInstancesChange={(next) => update({ instances: next })}
                onStart={async (instance) => {
                  const result = await window.sparkAPI.startInstance(instance)
                  if (result.success) {
                    setRunningInstances((prev) => new Set(prev).add(instance.id))
                  }
                  return result
                }}
                onStop={async (instanceId) => {
                  const result = await window.sparkAPI.stopInstance(instanceId)
                  // For cmd /c start-launched servers we don't track the PID,
                  // so nothing actually happens on the main side. Clear the
                  // UI's running flag anyway — the user is telling us the
                  // instance is no longer running, and the console window
                  // closure is the real stop signal.
                  setRunningInstances((prev) => {
                    const next = new Set(prev)
                    next.delete(instanceId)
                    return next
                  })
                  return result
                }}
                onReset={async (instance) => {
                  const result = await window.sparkAPI.resetInstance(instance)
                  // On success the instance is still running (a fresh process)
                  // — leave the flag set. On failure the previous process was
                  // killed but relaunch failed, so treat as stopped.
                  if (!result.success) {
                    setRunningInstances((prev) => {
                      const next = new Set(prev)
                      next.delete(instance.id)
                      return next
                    })
                  }
                  return result
                }}
              />
            </Box>
          )}
        </Box>

        {logPaneOpen && activeTab !== 2 && (
          <LogPane
            title="Hybrasyl Client"
            lines={hybrasylLog}
            onClear={() => setHybrasylLog([])}
            onSave={() => saveLogToFile(hybrasylLog, 'hybrasyl-client')}
            onClose={() => setLogPaneOpen(false)}
          />
        )}

        {logPaneOpen && activeTab === 2 && (
          <LogPane
            title={
              settings.instances.find((i) => i.id === settings.activeInstance)?.name ??
              'Server Instance'
            }
            lines={instanceLogs[settings.activeInstance] ?? []}
            onClear={() => setInstanceLogs((prev) => ({ ...prev, [settings.activeInstance]: [] }))}
            onSave={() => {
              const inst = settings.instances.find((i) => i.id === settings.activeInstance)
              const slug = (inst?.name ?? 'server-instance').replace(/[^A-Za-z0-9._-]+/g, '-')
              return saveLogToFile(instanceLogs[settings.activeInstance] ?? [], slug)
            }}
            onClose={() => setLogPaneOpen(false)}
          />
        )}

        {settingsOpen && (
          <SettingsPane
            settings={settings}
            versions={versions}
            onClose={() => setSettingsOpen(false)}
            onChange={update}
          />
        )}

        <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      </Box>
    </ThemeProvider>
  )
}
