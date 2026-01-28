import { ClickToComponent } from 'click-to-react-component';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './shared/lib/i18n' // Initialize i18n
import { loadLanguage } from '@/shared/lib/loadLanguage'
import { getStoredLanguage } from '@/shared/lib/i18n'
import App from '@/App.tsx'
import ErrorBoundary from '@/app/ErrorBoundary'

if (import.meta.env.DEV) {
  try {
    ClickToComponent();
  } catch (error) {
    // ClickToComponent requires an editor environment (VS Code/Cursor)
    // Silently fail if not available
  }
}

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
