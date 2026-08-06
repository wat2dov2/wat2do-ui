"use client";

import "@/app/english-locale";
import { createContext, lazy, Suspense, useContext, useEffect, useState, type ReactNode } from "react";
import "@/shared/lib/i18n";
import i18n, { getStoredLanguage } from "@/shared/lib/i18n";
import { loadLanguage } from "@/shared/lib/loadLanguage";
import ErrorBoundary from "@/app/ErrorBoundary";
import {
  fetchProfileAPI,
  getSessionEmail,
  getUserId,
  initializeAuth,
} from "@/features/auth/api/auth.api";
import { loadAppConstants } from "@/shared/api/metaApi";
import {
  identifyPostHogUser,
  resetPostHogUser,
} from "@/shared/lib/posthog";
import { setOnAfterRefresh } from "@/shared/services/apiClient";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { installBundledLocales } from "@/app/localeResources";
import { QueryClientProvider } from "@tanstack/react-query";
import { getQueryClient } from "@/shared/lib/queryClient";
import { queryKeys } from "@/shared/lib/queryKeys";

installBundledLocales();

const DevClickToComponent =
  process.env.NODE_ENV === "development"
    ? lazy(() =>
        import("click-to-react-component").then((module) => ({
          default: module.ClickToComponent,
        })),
      )
    : null;

/**
 * Whether the auth bootstrap has finished.
 *
 * Nothing waits on the language load any more: English is registered
 * synchronously by `english-locale.ts`, so pages render their real content on
 * the first paint and other languages swap in over it.
 */
const AuthReadyContext = createContext(false);

setOnAfterRefresh(() => {
  fetchProfileAPI().catch((err) =>
    console.error("Post-refresh profile fetch failed:", err),
  );
});

async function bootstrapConstants() {
  try {
    await loadAppConstants();
  } catch (err) {
    console.error("App constants initialization failed, using fallbacks:", err);
  }
}

async function bootstrapAuth(): Promise<boolean> {
  try {
    const ok = await Promise.race([
      initializeAuth(),
      new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error("initializeAuth timed out")), 5000),
      ),
    ]);
    if (ok) {
      window.dispatchEvent(new Event("auth-user-login"));
    }
    return ok;
  } catch (err) {
    console.error("Auth initialization failed or timed out, continuing without session:", err);
    return false;
  }
}

export function useAuthReady() {
  return useContext(AuthReadyContext);
}

export function ClientProviders({ children }: { children: ReactNode }) {
  const [authReady, setAuthReady] = useState(false);
  const [queryClient] = useState(() => getQueryClient());

  useEffect(() => {
    const handleLogin = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.user.all });
      identifyPostHogUser(getUserId(), getSessionEmail());
    };
    const handleLogout = () => {
      queryClient.removeQueries({ queryKey: queryKeys.user.all });
      queryClient.removeQueries({ queryKey: queryKeys.goingEvents.all });
      queryClient.removeQueries({
        queryKey: queryKeys.notificationPreferences.all,
      });
      queryClient.removeQueries({ queryKey: queryKeys.posters.all });
      queryClient.removeQueries({ queryKey: queryKeys.posterPayouts.all });
      resetPostHogUser();
    };
    window.addEventListener("auth-user-login", handleLogin);
    window.addEventListener("auth-user-logout", handleLogout);
    return () => {
      window.removeEventListener("auth-user-login", handleLogin);
      window.removeEventListener("auth-user-logout", handleLogout);
    };
  }, [queryClient]);

  useEffect(() => {
    let cancelled = false;

    async function initLanguage() {
      try {
        const initialLang = getStoredLanguage();
        await loadLanguage(initialLang);
        i18n.changeLanguage(initialLang);
      } catch (err) {
        console.error("Language initialization failed, falling back to English:", err);
      }

      if (!cancelled) {
        document.documentElement.dataset.clientReady = "true";
      }
    }

    void initLanguage();

    return () => {
      cancelled = true;
      delete document.documentElement.dataset.clientReady;
    };
  }, []);

  // Not chained behind the language load: restoring the session is a network
  // round trip, and every millisecond it waits is a millisecond the UI is
  // guessing about the signed-in state. They are unrelated, so they race.
  useEffect(() => {
    void bootstrapConstants();
    let cancelled = false;
    void bootstrapAuth().then((ok) => {
      if (ok) {
        identifyPostHogUser(getUserId(), getSessionEmail());
      }
      if (!cancelled) {
        setAuthReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <TooltipProvider delayDuration={0}>
          <AuthReadyContext.Provider value={authReady}>
            {DevClickToComponent ? (
              <Suspense fallback={null}>
                <DevClickToComponent />
              </Suspense>
            ) : null}
            {children}
          </AuthReadyContext.Provider>
        </TooltipProvider>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}
