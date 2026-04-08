import { useState, useEffect } from 'react'
import { ThemeProvider, CssBaseline } from '@mui/material'
import Box from '@mui/material/Box'
import hybrasylTheme from './themes/hybrasyl'
import chadulTheme from './themes/chadul'
import danaanTheme from './themes/danaan'
import grinnealTheme from './themes/grinneal'
import TitleBar from './components/TitleBar'
import ClientPathPicker from './components/ClientPathPicker'
import VersionSelector from './components/VersionSelector'
import ServerConfig from './components/ServerConfig'
import OptionsPanel from './components/OptionsPanel'
import ActionButtons from './components/ActionButtons'

const themes = {
  hybrasyl: hybrasylTheme,
  chadul: chadulTheme,
  danaan: danaanTheme,
  grinneal: grinnealTheme
}

const defaultSettings = {
  clientPath: '',
  version: 'auto',
  serverHostname: 'da0.kru.com',
  serverPort: 2610,
  redirectServer: true,
  skipIntro: true,
  multipleInstances: true,
  hideWalls: false,
  theme: 'hybrasyl'
}

export default function App() {
  const [settings, setSettings] = useState(defaultSettings)
  const [versions, setVersions] = useState([])
  const [detectedVersion, setDetectedVersion] = useState(null)
  const [themeName, setThemeName] = useState('hybrasyl')

  useEffect(() => {
    window.sparkAPI.loadSettings().then((s) => {
      setSettings((prev) => ({ ...prev, ...s }))
      if (s.theme && themes[s.theme]) setThemeName(s.theme)
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
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, p: 2 }}>
          <ClientPathPicker
            clientPath={settings.clientPath}
            detectedVersion={detectedVersion}
            onPathChange={(path) => {
              update({ clientPath: path })
              if (path) {
                window.sparkAPI.detectVersion(path).then((result) => {
                  setDetectedVersion(result.found ? result.name : null)
                  if (result.found && settings.version === 'auto') {
                    update({ version: result.versionCode })
                  }
                })
              } else {
                setDetectedVersion(null)
              }
            }}
          />
          <VersionSelector
            versions={versions}
            value={settings.version}
            onChange={(v) => update({ version: v })}
          />
          <OptionsPanel settings={settings} onChange={update} />
          <ServerConfig
            hostname={settings.serverHostname}
            port={settings.serverPort}
            disabled={!settings.redirectServer}
            onChange={update}
          />
          <ActionButtons settings={settings} />
        </Box>
      </Box>
    </ThemeProvider>
  )
}
