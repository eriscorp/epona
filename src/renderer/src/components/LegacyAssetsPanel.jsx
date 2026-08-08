import { useState, useEffect, useCallback } from 'react'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Typography from '@mui/material/Typography'
import PathPicker from './PathPicker'
import DarkAgesInstallPanel from './DarkAgesInstallPanel'
import { describeAssetDir } from '../../../shared/assetStatus.js'

// The Legacy Client tab on macOS and Linux.
//
// Launching is Windows-only and always will be — it patches a running client
// through native Win32 APIs. The Dark Ages INSTALLATION is not: the Hybrasyl
// client reads its graphics and sound from the same folder, passed through as
// DA_ASSET_PATH. So this tab still has a job on every platform, and this panel
// is that job with the launch controls removed rather than a placeholder.
//
// It writes to `clientPath`, the same setting the Windows panel uses for
// Dark Ages.exe. One field with two meanings is deliberate (HTOO-296): the
// file-or-directory normalisation lives in exactly one place, at launch.
export default function LegacyAssetsPanel({ clientPath, onChange }) {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    let cancelled = false
    window.sparkAPI.inspectAssetDir(clientPath).then((result) => {
      if (!cancelled) setStatus(result)
    })
    return () => {
      cancelled = true
    }
  }, [clientPath])

  const pick = useCallback(async () => {
    const path = await window.sparkAPI.pickDirectory(
      'Select your Dark Ages folder',
      clientPath,
      'Pick the folder containing Legend.dat and the other Dark Ages data files.'
    )
    if (path) onChange({ clientPath: path })
  }, [clientPath, onChange])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="body2" sx={{ opacity: 0.8 }}>
        Launching the legacy client needs Windows, so there is nothing to launch here. Epona still
        needs to know where your Dark Ages files are: the Hybrasyl client reads its graphics and
        sound from them.
      </Typography>

      <PathPicker
        label="Dark Ages folder"
        value={clientPath}
        onPick={pick}
        placeholder="Not set"
        pickTestId="asset-folder-browse"
        chip={
          status
            ? {
                label: status.ok ? 'Found' : 'Not found',
                color: status.ok ? 'success' : 'warning',
                'data-testid': 'asset-status-chip'
              }
            : undefined
        }
      />

      {status && (
        <Typography variant="caption" data-testid="asset-status-detail" sx={{ opacity: 0.7 }}>
          {describeAssetDir(status)}
        </Typography>
      )}

      <Divider />

      {/* HTOO-288. Below the picker rather than above it: a user who already has
          the files should reach the field they need first, and the install flow is
          the answer to the rarer question. It writes the same clientPath. */}
      <DarkAgesInstallPanel clientPath={clientPath} onChange={onChange} />
    </Box>
  )
}
