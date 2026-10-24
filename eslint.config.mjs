import reactPlugin from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
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
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Codebase is plain JS without runtime type checks; we don't author
      // propTypes shims. Disabling matches actual practice.
      'react/prop-types': 'off',
      // Allow `const { foo: _foo, ...rest } = obj` discard pattern.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Surface real hook bugs; exhaustive-deps warns (some effects
      // intentionally run once — those carry eslint-disable comments).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  }
]
