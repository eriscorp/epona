import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Needed for the renderer tests only — main-process specs are plain JS. It is
  // cheap enough at transform time not to be worth splitting into two projects.
  plugins: [react()],
  test: {
    // `node` stays the default deliberately: main-process specs outnumber
    // renderer ones and have no business paying for a DOM. A renderer test opts
    // itself in with a `// @vitest-environment jsdom` docblock on line 1.
    environment: 'node',
    include: ['src/**/*.test.{js,jsx,mjs,cjs}', 'scripts/**/*.test.{js,mjs,cjs}'],
    exclude: ['**/node_modules/**', '**/out/**', '**/dist/**']
  }
})
