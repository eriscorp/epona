import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx,mjs,cjs}', 'scripts/**/*.test.{js,mjs,cjs}'],
    exclude: ['**/node_modules/**', '**/out/**', '**/dist/**']
  }
})
