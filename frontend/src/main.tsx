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
import { initializeAuth } from '@/features/auth/api/auth.api'

if (import.meta.env.DEV) {
  try {
    (ClickToComponent as any)();
  } catch {
    // ClickToComponent requires an editor environment (VS Code/Cursor)
  }
}

// Initialize app - ensure translations are loaded before rendering
async function initApp() {
  const initialLang = getStoredLanguage();
  
  // Always load the initial language (including English) to ensure translations are available
  await loadLanguage(initialLang);
  // Change language after it's loaded
  i18n.changeLanguage(initialLang);

  // Restore auth session from httpOnly cookie (if user was previously logged in)
  await initializeAuth();

  // Render after language and auth are loaded
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
