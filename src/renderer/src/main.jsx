import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/cinzel'
import '@fontsource/cinzel-decorative'
import '@fontsource/crimson-pro'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { installRendererErrorForwarding } from './reportErrors.js'
import './assets/base.css'

// Forward uncaught renderer errors + promise rejections to main so they land in the
// same scrubbed session log as main-process and React errors.
installRendererErrorForwarding()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Outside App so a crash in the themed tree still renders a usable fallback. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
