import { useState, useEffect } from 'react'
import { ThemeProvider, CssBaseline, GlobalStyles, alpha } from '@mui/material'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
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
import ActionButtons from './components/ActionButtons'
import SettingsDrawer from './components/SettingsDrawer'
import LogPane from './components/LogPane'

const TAB_ORDER = ['legacy', 'hybrasyl']
const kindToIndex = (k) => {
  const i = TAB_ORDER.indexOf(k)
  return i >= 0 ? i : 0
}

const MAIN_W = 480
const PANE_W = 360
const WINDOW_H = 640
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
    { id: 'official', name: 'Dark Ages (Official)', hostname: 'da0.kru.com', port: 2610, redirect: false }
  ],
  targets: { hybrasyl: { clientPath: '', dataPath: 'E:\\Games\\Dark Ages', showConsole: false } }
}

export default function App() {
  const [settings, setSettings] = useState(defaultSettings)
  const [versions, setVersions] = useState([])
  const [detectedVersion, setDetectedVersion] = useState(null)
  const [themeName, setThemeName] = useState('hybrasyl')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState(0)
  const [logPaneOpen, setLogPaneOpen] = useState(false)
  const [hybrasylLog, setHybrasylLog] = useState([])

  useEffect(() => {
    window.sparkAPI.loadSettings().then((s) => {
      setSettings((prev) => ({ ...prev, ...s }))
      if (s.theme && themes[s.theme]) setThemeName(s.theme)
      if (s.targetKind) setActiveTab(kindToIndex(s.targetKind))
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
    return () => {
      offLog?.()
      offExit?.()
    }
  }, [])

  useEffect(() => {
    const width = logPaneOpen ? MAIN_W + PANE_W : MAIN_W
    window.sparkAPI.resizeWindow(width, WINDOW_H)
  }, [logPaneOpen])

  function update(patch) {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      window.sparkAPI.saveSettings(next)
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
    const path = await window.sparkAPI.openExeDialog()
    if (path) update({ clientPath: path })
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
      <Box sx={{ display: 'flex', flexDirection: 'row', width: '100%', height: WINDOW_H, bgcolor: 'background.default' }}>
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
          onLocateClient={handleLocateClient}
          onToggleSettings={() => setSettingsOpen((o) => !o)}
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
          <Tab label="Legacy Client" />
          <Tab label="Hybrasyl Client" />
        </Tabs>
        <Divider sx={{ borderColor: 'rgba(255,255,255,0.15)' }} />

        {activeTab === 0 && (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, p: 2 }}>
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
      </Box>

      {logPaneOpen && (
        <LogPane
          title="Hybrasyl Client"
          lines={hybrasylLog}
          onClear={() => setHybrasylLog([])}
          onClose={() => setLogPaneOpen(false)}
        />
      )}
      </Box>

      <SettingsDrawer
        open={settingsOpen}
        settings={settings}
        versions={versions}
        onClose={() => setSettingsOpen(false)}
        onChange={update}
      />
    </ThemeProvider>
  )
}
