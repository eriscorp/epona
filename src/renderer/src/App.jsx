import { useState, useEffect } from 'react'
import { ThemeProvider, CssBaseline, GlobalStyles, alpha } from '@mui/material'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
// Epona renders the house themes with its own text sizes (themes/eponaThemes.js).
import { themesByName } from './themes/eponaThemes'
import AppTitleBar from './components/AppTitleBar'
import NavToolbar from './components/NavToolbar'
import ProfileSelector from './components/ProfileSelector'
import OptionsPanel from './components/OptionsPanel'
import HybrasylClientPanel from './components/HybrasylClientPanel'
import ServerInstancePanel from './components/ServerInstancePanel'
import ActionButtons from './components/ActionButtons'
import LegacyAssetsPanel from './components/LegacyAssetsPanel'
import DarkAgesInstallPanel from './components/DarkAgesInstallPanel'
import SettingsPane from './components/SettingsPane'
import LogPane from './components/LogPane'
import HelpDialog from './components/HelpDialog'
import ReportIssueDialog from './components/ReportIssueDialog'
import UpdateNotice from './components/UpdateNotice'
import BridgeErrorBanner from './components/BridgeErrorBanner'
import SnackbarHost from './components/SnackbarHost'
import { revealFailure } from './revealFailure'
import ThemeGallery from './pages/ThemeGallery'
import { PANEL_BORDER_COLOR, MAIN_W, PANE_W, GALLERY_W } from './uiConstants.js'
import { resolveVersionCode, supportsPatch } from './runtimePatchGate.js'
import { serverExitNotice } from './serverExitNotice.js'
import { defaultSettings } from '../../shared/defaultSettings.js'
import { useSettings } from './store/settingsStore.js'
import { useRuntime } from './store/runtimeStore.js'
import { useAppMenu } from './appMenu.js'
import { GO_TABS } from '../../shared/appMenu.js'

// The tab bar and the macOS Go menu read the same list, so they cannot disagree.
const TAB_ORDER = GO_TABS.map((t) => t.tab)
const kindToIndex = (k) => {
  const i = TAB_ORDER.indexOf(k)
  return i >= 0 ? i : 0
}

// Which tab to open on startup. Every tab is valid on every platform: the
// Legacy tab shows the Dark Ages asset folder off Windows rather than a launch
// surface, so there is no longer a persisted target to redirect away from.
const startupTabIndex = (targetKind) => kindToIndex(targetKind)

// MAIN_W / PANE_W live in uiConstants.js so SettingsPane and LogPane size
// themselves from the same numbers this resize request is built from.
const WINDOW_H = 800

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
  const [activeTab, setActiveTab] = useState(() => startupTabIndex(defaultSettings.targetKind))
  const [logPaneOpen, setLogPaneOpen] = useState(false)
  // The house theme gallery (HTOO-572), opened from Settings → Theme. It takes
  // the main panel in place of the tabs, in a wider window.
  const [galleryOpen, setGalleryOpen] = useState(false)
  // Server running-state comes from the main process, which polls tracked-process
  // liveness and probes each instance's lobby port. Keeping our own guess here is
  // what used to leave the tab showing "Start Server" for a server that was very
  // much running. Shape: { [instanceId]: { running, pid, source, ambiguousPort } }.
  const [instanceStatus, setInstanceStatus] = useState({})
  // A server that exited when nobody asked it to: { instanceId, message }
  // (HTOO-590). Shown with the Log Pane closed, on any tab.
  const [exitNotice, setExitNotice] = useState(null)
  // A Reveal menu item whose folder did not open (HTOO-658). The exit notice
  // shares the one snackbar and goes first.
  const [folderNotice, setFolderNotice] = useState(null)
  // Non-null when the IPC bridge could not be reached at startup. Renders a
  // banner that itself uses no IPC — the existing Report Issue dialog and
  // "Reveal logs" are both invokes, so in exactly this state they are dead too.
  const [bridgeError, setBridgeError] = useState(null)
  // True once settings have hydrated. The macOS menu waits for it, so it never
  // reports or acts on the defaults the store starts with.
  const [ready, setReady] = useState(false)

  const applyStatus = (snapshot) =>
    setInstanceStatus(Object.fromEntries((snapshot ?? []).map((s) => [s.id, s])))

  useEffect(() => {
    hydrate()
      .then((s) => {
        if (s.targetKind) setActiveTab(startupTabIndex(s.targetKind))
        setReady(true)
      })
      .catch((err) => {
        // hydrate() awaits an IPC invoke. If the bridge is unreachable this
        // rejects, and WITHOUT this catch the .then never ran — so appReady was
        // never signalled, the splash sat for the full 15s backstop, and the app
        // then opened on default settings with every IPC-backed control dead
        // while checkboxes and text fields still worked. Silent, and it read as
        // "slow app with broken buttons" rather than "the bridge is down".
        setBridgeError(err?.message ?? String(err))
      })
      .finally(() => {
        // Signal READY EITHER WAY. A broken bridge must not also cost 15 seconds
        // of blank splash — a visible app that says what is wrong beats a hidden
        // one that says nothing.
        window.sparkAPI?.appReady?.()
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
      ({ instanceId, pid, code, signal, unexpected }) => {
        // Read the run's log before its exit line goes in.
        if (unexpected) {
          const instance = useSettings
            .getState()
            .settings.instances.find((i) => i.id === instanceId)
          const lines = useRuntime.getState().instanceLogs[instanceId] ?? []
          setExitNotice({
            instanceId,
            message: serverExitNotice({
              name: instance?.name ?? 'Server instance',
              code,
              signal,
              lines
            })
          })
        }
        const label = signal ? `signal ${signal}` : `exit code ${code}`
        appendInstance(instanceId, 'exit', `— process ${pid} ended (${label}) —`)
        // The process is gone, so the row is stopped now (HTOO-589). Main's
        // forced status push follows; this saves the wait for it.
        setInstanceStatus((prev) =>
          prev[instanceId]?.running
            ? { ...prev, [instanceId]: { id: instanceId, running: false, source: null } }
            : prev
        )
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
    const width =
      (galleryOpen ? GALLERY_W : MAIN_W) + (settingsOpen ? PANE_W : 0) + (logPaneOpen ? PANE_W : 0)
    window.sparkAPI.resizeWindow(width, WINDOW_H)
  }, [galleryOpen, logPaneOpen, settingsOpen])

  // The gallery closes the side panes: it has its own theme picker, and it needs
  // the width.
  function openGallery() {
    setSettingsOpen(false)
    setLogPaneOpen(false)
    setGalleryOpen(true)
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

  // The tab bar's change handler. The Go menu (macOS) runs the same one.
  // A tab chosen from the Go menu also closes the theme gallery, which hides the tabs.
  function selectTab(index) {
    setGalleryOpen(false)
    setActiveTab(index)
    update({ targetKind: TAB_ORDER[index] })
  }

  // The server's output reaches Epona on macOS and Linux, where the server runs
  // as Epona's child (HTOO-590). On Windows it runs in its own console window, so
  // its output does not reach the pane yet (HTOO-652).
  const serverLogPane = !isWindows

  // The console button on the Hybrasyl Client tab is enabled in repo mode only,
  // and the one on the Server tab where the server's output reaches Epona. The
  // menu's Log Pane item follows them. An open pane stays open on the other
  // tabs, so the item is also enabled while the pane is open, to close it.
  const canToggleLogPane =
    logPaneOpen ||
    (activeTab === 1 && settings.targets.hybrasyl.mode === 'repo') ||
    (activeTab === 2 &&
      serverLogPane &&
      settings.instances.some((i) => i.id === settings.activeInstance))

  // The macOS application menu (src/main/appMenu.js). Each command runs the same
  // handler as its button. Inert off macOS.
  useAppMenu(
    ready,
    { tab: TAB_ORDER[activeTab], canToggleLogPane, logPaneOpen },
    {
      goTab: (tab) => {
        const index = TAB_ORDER.indexOf(tab)
        if (index >= 0) selectTab(index)
      },
      openSettings: () => setSettingsOpen(true),
      locateClient: handleLocateClient,
      revealSettings: async () =>
        setFolderNotice(revealFailure(await window.sparkAPI.revealSettings())),
      revealLogs: async () => setFolderNotice(revealFailure(await window.sparkAPI.revealLogs())),
      toggleLogPane: () => {
        if (canToggleLogPane) setLogPaneOpen((o) => !o)
      },
      openHelp: () => setHelpOpen(true),
      openReportIssue: () => setReportOpen(true)
    }
  )

  // The notice's Show log: the Server tab, that instance, and the pane.
  function showServerLog(instanceId) {
    setExitNotice(null)
    selectTab(TAB_ORDER.indexOf('server'))
    update({ activeInstance: instanceId })
    setLogPaneOpen(true)
  }

  // Hook-based Legacy options only exist for client builds whose hook sites have
  // been mapped, so resolve which build will actually launch and ask it.
  const availablePatches = (() => {
    const code = resolveVersionCode(settings.version, detectedVersionCode)
    return supportsPatch(versions, code, 'groundItemHints') ? ['groundItemHints'] : []
  })()

  const currentTheme = themesByName[settings.theme] || themesByName.hybrasyl
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
          <AppTitleBar />
          <Divider sx={{ borderColor: PANEL_BORDER_COLOR }} />
          <BridgeErrorBanner error={bridgeError} />
          <NavToolbar
            detectedVersion={detectedVersion}
            clientPath={settings.clientPath}
            settingsOpen={settingsOpen}
            onLocateClient={handleLocateClient}
            onToggleSettings={() => setSettingsOpen((o) => !o)}
            onOpenHelp={() => setHelpOpen(true)}
            onReportIssue={() => setReportOpen(true)}
          />
          <Divider sx={{ borderColor: PANEL_BORDER_COLOR }} />

          {galleryOpen ? (
            <ThemeGallery onBack={() => setGalleryOpen(false)} />
          ) : (
            <>
              <Tabs
                value={activeTab}
                onChange={(_, v) => selectTab(v)}
                variant="fullWidth"
                sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, textTransform: 'none' } }}
              >
                {/* Literal values, not a .map: see A2 in docs/plans/00a-backlog.md.
                    Each tab and its panel carry `tab-<kind>` and `page-<kind>`, the
                    TAB_ORDER key. e2e/nav-pages.spec.js reads the tab list and clicks
                    each one, so a tab added here needs both ids. */}
                <Tab value={0} label={GO_TABS[0].label} data-testid="tab-legacy" />
                <Tab value={1} label={GO_TABS[1].label} data-testid="tab-hybrasyl" />
                <Tab value={2} label={GO_TABS[2].label} data-testid="tab-server" />
              </Tabs>
              <Divider sx={{ borderColor: PANEL_BORDER_COLOR }} />

              {activeTab === 0 && (
                <Box
                  data-testid="page-legacy"
                  sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, p: 2 }}
                >
                  {isWindows ? (
                    <>
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
                      <Divider />
                      {/* The unpacker is not macOS/Linux-only. It reads the installer
                          with zlib and works identically here, so a Windows user with
                          no client can get one without leaving the app. Below the
                          launch controls because launching is what this tab is for and
                          what most visits want. */}
                      <DarkAgesInstallPanel
                        clientPath={settings.clientPath}
                        onChange={update}
                        isWindows
                      />
                    </>
                  ) : (
                    <LegacyAssetsPanel clientPath={settings.clientPath} onChange={update} />
                  )}
                </Box>
              )}

              {activeTab === 1 && (
                <Box
                  data-testid="page-hybrasyl"
                  sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, p: 2 }}
                >
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
                  data-testid="page-server"
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
                    logPaneAvailable={serverLogPane}
                    logPaneOpen={logPaneOpen}
                    onToggleLogPane={() => setLogPaneOpen((o) => !o)}
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
            </>
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
            onOpenThemeGallery={openGallery}
          />
        )}

        <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
        <ReportIssueDialog open={reportOpen} onClose={() => setReportOpen(false)} />
        <SnackbarHost
          snack={
            exitNotice
              ? {
                  severity: 'error',
                  message: exitNotice.message,
                  duration: 15000,
                  action: serverLogPane
                    ? { label: 'Show log', onClick: () => showServerLog(exitNotice.instanceId) }
                    : undefined
                }
              : folderNotice
          }
          onClose={() => (exitNotice ? setExitNotice(null) : setFolderNotice(null))}
        />
        {/* Mounted unconditionally and self-scheduling: it renders nothing until
            its own delayed check comes back with an undismissed newer release. */}
        <UpdateNotice />
      </Box>
    </ThemeProvider>
  )
}
