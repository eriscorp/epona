import { useState, useEffect } from 'react'
import { ThemeProvider, CssBaseline } from '@mui/material'
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
import ActionButtons from './components/ActionButtons'
import SettingsDrawer from './components/SettingsDrawer'

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
  ]
}

export default function App() {
  const [settings, setSettings] = useState(defaultSettings)
  const [versions, setVersions] = useState([])
  const [detectedVersion, setDetectedVersion] = useState(null)
  const [themeName, setThemeName] = useState('hybrasyl')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState(0)

  useEffect(() => {
    window.sparkAPI.loadSettings().then((s) => {
      setSettings((prev) => ({ ...prev, ...s }))
      if (s.theme && themes[s.theme]) setThemeName(s.theme)
      if (s.clientPath) {
        window.sparkAPI.detectVersion(s.clientPath).then((result) => {
          setDetectedVersion(result.found ? result.name : null)
        })
      }
    })
    window.sparkAPI.listVersions().then(setVersions)
  }, [])

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
      <Box
        sx={{
          width: 480,
          height: 640,
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
          onChange={(_, v) => setActiveTab(v)}
          variant="fullWidth"
          sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, textTransform: 'none' } }}
        >
          <Tab label="Legacy Client" />
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
            <ActionButtons settings={settings} getActiveProfile={getActiveProfile} />
          </Box>
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
