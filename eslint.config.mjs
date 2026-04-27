import reactPlugin from 'eslint-plugin-react'
import electronToolkit from '@electron-toolkit/eslint-config'
import electronToolkitPrettier from '@electron-toolkit/eslint-config-prettier'

export default [
  { ignores: ['node_modules/**', 'dist/**', 'out/**', 'packages/da-win32/build/**'] },
  { files: ['**/*.{js,jsx,mjs,cjs}'] },
  electronToolkit,
  reactPlugin.configs.flat.recommended,
  reactPlugin.configs.flat['jsx-runtime'],
  { settings: { react: { version: 'detect' } } },
  electronToolkitPrettier,
  {
    rules: {
      // Codebase is plain JS without runtime type checks; we don't author
      // propTypes shims. Disabling matches actual practice.
      'react/prop-types': 'off',
      // Allow `const { foo: _foo, ...rest } = obj` discard pattern.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  }
]
