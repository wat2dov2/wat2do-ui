import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './lib/i18n' // Initialize i18n
import { loadLanguage } from './lib/loadLanguage'
import { getStoredLanguage } from './lib/i18n'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'

// Load initial language before rendering
async function initApp() {
  const initialLang = getStoredLanguage();
  await loadLanguage(initialLang);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ErrorBoundary>
    </StrictMode>,
  )
}

initApp();
