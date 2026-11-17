import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Needed for the renderer tests only — main-process specs are plain JS. It is
  // cheap enough at transform time not to be worth splitting into two projects.
  plugins: [react()],
  // `original-fs` exists only inside Electron. Under Node, `fs` is the same
  // module without the asar patch, so the tests that import index.js resolve it.
  resolve: {
    alias: { 'original-fs': 'fs' }
  },
  test: {
    // `node` stays the default deliberately: main-process specs outnumber
    // renderer ones and have no business paying for a DOM. A renderer test opts
    // itself in with a `// @vitest-environment jsdom` docblock on line 1.
    environment: 'node',
    // vitest 5 clears every mock before each test by default. The index.js
    // suites boot main once, in beforeAll, and then read what the boot called
    // (setPath, setApplicationMenu, the lock check). A clear before each test
    // erases those calls. This is vitest 4's value (HTOO-694).
    clearMocks: false,
    include: ['src/**/*.test.{js,jsx,mjs,cjs}', 'scripts/**/*.test.{js,mjs,cjs}'],
    exclude: ['**/node_modules/**', '**/out/**', '**/dist/**']
  }
})
