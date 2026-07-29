import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['da-win32']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    base: './',
    // NO publicDir. The scaffold set this to resolve('resources'), which copied
    // that whole tree verbatim into out/renderer — and since electron-builder
    // also asarUnpacks resources/**, every file in it shipped TWICE. The
    // renderer references nothing there: splash.html and the window icon are
    // both loaded by the MAIN process via join(__dirname, '../../resources/…'),
    // which reads the asarUnpacked copy. The renderer's own logo is imported
    // from src/renderer/src/assets/ and hashed into the bundle by vite.
    // Re-adding a publicDir pointed at resources/ silently restores the
    // double-ship for every asset in it, present and future.
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      outDir: 'out/renderer'
    }
  }
})
