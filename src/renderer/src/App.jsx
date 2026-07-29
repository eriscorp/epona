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
import mundanesTheme from './themes/mundanes'
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
import ReportIssueDialog from './components/ReportIssueDialog'
import { PANEL_BORDER_COLOR, MAIN_W, PANE_W } from './uiConstants.js'
import { resolveVersionCode, supportsPatch } from './runtimePatchGate.js'
import { defaultSettings } from '../../shared/defaultSettings.js'
import { useSettings } from './store/settingsStore.js'
import { useRuntime } from './store/runtimeStore.js'

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

// MAIN_W / PANE_W live in uiConstants.js so SettingsPane and LogPane size
// themselves from the same numbers this resize request is built from.
const WINDOW_H = 800

const themes = {
  hybrasyl: hybrasylTheme,
  chadul: chadulTheme,
  danaan: danaanTheme,
  grinneal: grinnealTheme,
  spark: sparkTheme,
  mundanes: mundanesTheme
}

export default function App() {
  const isWindows = window.sparkAPI.platform === 'win32'
  // Persisted settings + client-version detection live in the settings store
  // (unit-tested, debounced save). Logs live in the runtime store so streaming
  // re-renders only the LogPane. Ephemeral UI toggles stay local.
  const settings = useSettings((s) => s.settings)
  const versions = useSettings((s) => s.versions)
  const detectedVersion = useSettings((s) => s.detectedVersion)
  const detectedVersionCode = useSettings((s) => s.detectedVersionCode)
  const update = useSettings((s) => s.update)
  const hydrate = useSettings((s) => s.hydrate)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [activeTab, setActiveTab] = useState(() =>
    startupTabIndex(defaultSettings.targetKind, isWindows)
  )
  const [logPaneOpen, setLogPaneOpen] = useState(false)
  // Server running-state comes from the main process, which polls tracked-process
  // liveness and probes each instance's lobby port. Keeping our own guess here is
  // what used to leave the tab showing "Start Server" for a server that was very
  // much running. Shape: { [instanceId]: { running, pid, source, ambiguousPort } }.
  const [instanceStatus, setInstanceStatus] = useState({})

  const applyStatus = (snapshot) =>
    setInstanceStatus(Object.fromEntries((snapshot ?? []).map((s) => [s.id, s])))

  useEffect(() => {
    hydrate().then((s) => {
      if (s.targetKind) setActiveTab(startupTabIndex(s.targetKind, isWindows))
      // Settings are hydrated and applied — tell the main process to dismiss the
      // splash and reveal the main window (now painting a populated first frame).
      window.sparkAPI.appReady()
    })
    // Runs once on mount; hydrate is a stable store action, isWindows is constant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Route the main→renderer log/exit streams into the runtime store. App
    // itself doesn't subscribe to the logs, so a busy stream re-renders only
    // the LogPane, not the whole tree.
    const { appendHybrasyl, appendInstance } = useRuntime.getState()
    const offLog = window.sparkAPI.onHybrasylLog(({ stream, line }) => appendHybrasyl(stream, line))
    const offExit = window.sparkAPI.onHybrasylChildExit(({ pid, code, signal }) => {
      const label = signal ? `signal ${signal}` : `exit code ${code}`
      appendHybrasyl('exit', `— process ${pid} ended (${label}) —`)
    })
    const offInstanceLog = window.sparkAPI.onInstanceLog(({ instanceId, stream, line }) =>
      appendInstance(instanceId, stream, line)
    )
    const offInstanceExit = window.sparkAPI.onInstanceChildExit(
      ({ instanceId, pid, code, signal }) => {
        const label = signal ? `signal ${signal}` : `exit code ${code}`
        appendInstance(instanceId, 'exit', `— process ${pid} ended (${label}) —`)
      }
    )
    // Seed from a forced pass, then follow main's pushes. Main only pushes when
    // the snapshot actually changes.
    const offStatus = window.sparkAPI.onInstanceStatus(applyStatus)
    window.sparkAPI
      .getInstanceStatus()
      .then(applyStatus)
      .catch(() => {})
    return () => {
      offLog?.()
      offExit?.()
      offInstanceLog?.()
      offInstanceExit?.()
      offStatus?.()
    }
  }, [])

  useEffect(() => {
    const width = MAIN_W + (settingsOpen ? PANE_W : 0) + (logPaneOpen ? PANE_W : 0)
    window.sparkAPI.resizeWindow(width, WINDOW_H)
  }, [logPaneOpen, settingsOpen])

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

  // Hook-based Legacy options only exist for client builds whose hook sites have
  // been mapped, so resolve which build will actually launch and ask it.
  const availablePatches = (() => {
    const code = resolveVersionCode(settings.version, detectedVersionCode)
    return supportsPatch(versions, code, 'groundItemHints') ? ['groundItemHints'] : []
  })()

  const currentTheme = themes[settings.theme] || hybrasylTheme
  // Resolve the active server instance once — reused for the client tab's
  // auto-save target and the server LogPane's title/slug.
  const activeInstance = settings.instances.find((i) => i.id === settings.activeInstance)

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
          // Fill the actual window client area rather than a fixed WINDOW_H —
          // the programmatic resize can leave the client a hair off, and a fixed
          // pixel height would then reveal a background.default letterbox band
          // (obvious on the light themes).
          height: '100%',
          // Last line of defence. The flex rules above mean the layout should
          // already fit any viewport it is given; if some future child does
          // overflow anyway, clip it rather than letting the whole app scroll
          // sideways and push content past the right edge.
          overflowX: 'hidden',
          bgcolor: 'background.default'
        }}
      >
        <Box
          data-testid="main-panel"
          sx={{
            // Grow AND shrink from a MAIN_W basis, rather than a rigid
            // `0 0 MAIN_W`. The panes are rigid, so at the requested window
            // width this still resolves to exactly MAIN_W — but when the OS
            // hands back a narrower client area than we asked for, the shortfall
            // is absorbed here instead of overflowing off the right edge.
            // minWidth: 0 is required for a flex child to shrink below its
            // content's intrinsic width.
            flex: `1 1 ${MAIN_W}px`,
            minWidth: 0,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'background.default',
            overflow: 'hidden'
          }}
        >
          <TitleBar />
          <Divider sx={{ borderColor: PANEL_BORDER_COLOR }} />
          <NavToolbar
            detectedVersion={detectedVersion}
            clientPath={settings.clientPath}
            onLocateClient={handleLocateClient}
            onToggleSettings={() => setSettingsOpen((o) => !o)}
            onOpenHelp={() => setHelpOpen(true)}
            onReportIssue={() => setReportOpen(true)}
          />
          <Divider sx={{ borderColor: PANEL_BORDER_COLOR }} />

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
          <Divider sx={{ borderColor: PANEL_BORDER_COLOR }} />

          {activeTab === 0 && (
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, p: 2 }}>
              {!isWindows && (
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
              <OptionsPanel
                settings={settings}
                onChange={update}
                availablePatches={availablePatches}
              />
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
                activeInstanceLogDir={activeInstance?.logDir || ''}
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
                statusById={instanceStatus}
                worldDirectories={settings.worldDirectories}
                activeWorldDirectory={settings.activeWorldDirectory}
                onOpenSettings={() => setSettingsOpen(true)}
                onSelect={(id) => update({ activeInstance: id })}
                onInstancesChange={(next) => update({ instances: next })}
                // Start/Stop/Reset write an optimistic row so the button flips on
                // the round trip instead of waiting out the poll interval; main's
                // next push overrides it either way.
                onStart={async (instance) => {
                  const result = await window.sparkAPI.startInstance(instance)
                  if (result.success) {
                    setInstanceStatus((prev) => ({
                      ...prev,
                      [instance.id]: { id: instance.id, running: true, source: 'tracked' }
                    }))
                  }
                  return result
                }}
                onStop={async (instanceId) => {
                  const result = await window.sparkAPI.stopInstance(instanceId)
                  if (result.success) {
                    setInstanceStatus((prev) => ({
                      ...prev,
                      [instanceId]: { id: instanceId, running: false, source: null }
                    }))
                  }
                  return result
                }}
                onReset={async (instance) => {
                  const result = await window.sparkAPI.resetInstance(instance)
                  setInstanceStatus((prev) => ({
                    ...prev,
                    [instance.id]: {
                      id: instance.id,
                      running: result.success,
                      source: result.success ? 'tracked' : null
                    }
                  }))
                  return result
                }}
              />
            </Box>
          )}
        </Box>

        {logPaneOpen && activeTab !== 2 && (
          <LogPane
            source="hybrasyl"
            title="Hybrasyl Client"
            slug="hybrasyl-client"
            onClose={() => setLogPaneOpen(false)}
          />
        )}

        {logPaneOpen && activeTab === 2 && (
          <LogPane
            source={settings.activeInstance}
            title={activeInstance?.name ?? 'Server Instance'}
            slug={(activeInstance?.name ?? 'server-instance').replace(/[^A-Za-z0-9._-]+/g, '-')}
            onClose={() => setLogPaneOpen(false)}
          />
        )}

        {settingsOpen && (
          <SettingsPane
            settings={settings}
            versions={versions}
            onClose={() => setSettingsOpen(false)}
            onChange={update}
            onReportIssue={() => setReportOpen(true)}
          />
        )}

        <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
        <ReportIssueDialog open={reportOpen} onClose={() => setReportOpen(false)} />
      </Box>
    </ThemeProvider>
  )
}
