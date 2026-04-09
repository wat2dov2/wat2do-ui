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
import { loadAppConstants } from '@/shared/api/metaApi'

if (import.meta.env.DEV) {
  try {
    // ClickToComponent is typed as a React component but exported as a plain function
    // in dev mode. Cast to a generic callable to invoke it without JSX.
    (ClickToComponent as unknown as () => void)();
  } catch (err) {
    console.error("ClickToComponent initialization failed (requires editor environment):", err);
  }
}

// Initialize app - load translations, constants, and auth before rendering.
// Each step is individually guarded so the app always renders, even if
// non-critical initialization fails (English-only > white screen).
async function initApp() {
  try {
    const initialLang = getStoredLanguage();
    await loadLanguage(initialLang);
    i18n.changeLanguage(initialLang);
  } catch (err) {
    console.error("Language initialization failed, falling back to English:", err);
  }

  try {
    await loadAppConstants();
  } catch (err) {
    console.error("App constants initialization failed, using fallbacks:", err);
  }

  try {
    await initializeAuth();
  } catch (err) {
    console.error("Auth initialization failed, continuing without session:", err);
  }

  // Always render — a degraded app is better than a white screen.
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

initApp().catch((err) =>
  console.error("Critical: initApp failed unexpectedly:", err),
);
