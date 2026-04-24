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
import { fetchProfileAPI, initializeAuth } from '@/features/auth/api/auth.api'
import { setOnAfterRefresh } from '@/shared/services/apiClient'
import { loadAppConstants } from '@/shared/api/metaApi'
import { initClarity } from '@/shared/lib/clarity'

initClarity(import.meta.env.VITE_CLARITY_PROJECT_ID)

// After a silent 401 token refresh, re-fetch /users/me so cached
// role/hasClub stay in sync with the backend (AUTH-010). The main.tsx
// bootstrap is the single place wiring this — no cycle with auth.api.ts.
setOnAfterRefresh(() => {
  fetchProfileAPI().catch((err) =>
    console.error('Post-refresh profile fetch failed:', err),
  )
})

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

  // A14: cap the auth bootstrap on a hard 5 s timeout so a hanging refresh
  // request (Supabase slowness, DNS weirdness, etc.) cannot stall the whole
  // splash screen indefinitely.  Errors/timeouts are swallowed — the app still
  // renders in an unauthenticated state.
  try {
    await Promise.race([
      initializeAuth(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("initializeAuth timed out")), 5000),
      ),
    ]);
  } catch (err) {
    console.error("Auth initialization failed or timed out, continuing without session:", err);
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
