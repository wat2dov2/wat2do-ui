import { ClickToComponent } from 'click-to-react-component';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './shared/lib/i18n' // Initialize i18n (English preloaded)
import i18n from '@/shared/lib/i18n'
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

// Simplified initialization - English is preloaded, only load if different
async function initApp() {
  const initialLang = getStoredLanguage();
  
  // Load language if not English (English is already preloaded in i18n.ts)
  // Wait for it to load to ensure translations are available
  if (initialLang !== 'en') {
    await loadLanguage(initialLang);
    // Change language after it's loaded
    i18n.changeLanguage(initialLang);
  }

  // Render after language is loaded
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
