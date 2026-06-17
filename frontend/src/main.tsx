import { ClickToComponent } from 'click-to-react-component';
import { Analytics } from '@vercel/analytics/react';
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
// role/hasOrganization stay in sync with the backend (AUTH-010). The main.tsx
// bootstrap is the single place wiring this — no cycle with auth.api.ts.
const DevClickToComponent = import.meta.env.DEV ? ClickToComponent : null;

setOnAfterRefresh(() => {
  fetchProfileAPI().catch((err) =>
    console.error('Post-refresh profile fetch failed:', err),
  )
})

function renderApp() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          {DevClickToComponent ? <DevClickToComponent /> : null}
          <App />
          <Analytics />
        </BrowserRouter>
      </ErrorBoundary>
    </StrictMode>,
  )
}

async function bootstrapConstants() {
  try {
    await loadAppConstants();
  } catch (err) {
    console.error("App constants initialization failed, using fallbacks:", err);
  }
}

async function bootstrapAuth() {
  // A14: cap the auth bootstrap on a hard 5 s timeout so a hanging refresh
  // request (Supabase slowness, DNS weirdness, etc.) cannot stall the app.
  try {
    const ok = await Promise.race([
      initializeAuth(),
      new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error("initializeAuth timed out")), 5000),
      ),
    ]);
    if (ok && typeof window !== "undefined") {
      window.dispatchEvent(new Event("auth-user-login"));
    }
  } catch (err) {
    console.error("Auth initialization failed or timed out, continuing without session:", err);
  }
}

// Initialize app. Language and domain constants block first paint; auth can
// hydrate from localStorage before the refresh request completes.
async function initApp() {
  try {
    const initialLang = getStoredLanguage();
    await loadLanguage(initialLang);
    i18n.changeLanguage(initialLang);
  } catch (err) {
    console.error("Language initialization failed, falling back to English:", err);
  }

  await bootstrapConstants();
  renderApp();
  void bootstrapAuth();
}

initApp().catch((err) =>
  console.error("Critical: initApp failed unexpectedly:", err),
);
