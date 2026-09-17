"use client";

import "@/app/english-locale";
import { createContext, lazy, Suspense, useContext, useEffect, useState, type ReactNode } from "react";
import "@/shared/lib/i18n";
import i18n, { getStoredLanguage } from "@/shared/lib/i18n";
import { loadLanguage } from "@/shared/lib/loadLanguage";
import ErrorBoundary from "@/app/ErrorBoundary";
import {
  fetchProfileAPI,
  initializeAuth,
} from "@/features/auth/api/auth.api";
import { setOnAfterRefresh } from "@/shared/services/apiClient";
import { appConstantsQueryOptions } from "@/shared/api/metaApi";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { getQueryClient } from "@/shared/lib/queryClient";
import { queryKeys } from "@/shared/lib/queryKeys";
import type { SchoolSummary } from "@/shared/api/schools.api";
import { DEFAULT_SCHOOL } from "@/shared/constants/schools";
import { NavigationProgress } from "@/shared/ui/navigation-progress";

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
const RequestSchoolContext = createContext(DEFAULT_SCHOOL);

setOnAfterRefresh(() => {
  fetchProfileAPI().catch((err) =>
    console.error("Post-refresh profile fetch failed:", err),
  );
});

async function bootstrapAuth(): Promise<boolean> {
  try {
    const ok = await Promise.race([
      initializeAuth(),
      new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error("initializeAuth timed out")), 10000),
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

/** School resolved from the request host, stable across SSR and hydration. */
export function useRequestSchool() {
  return useContext(RequestSchoolContext);
}

interface ClientProvidersProps {
  children: ReactNode;
  initialSchool: string;
  initialSchools?: SchoolSummary[];
}

export function ClientProviders({
  children,
  initialSchool,
  initialSchools,
}: ClientProvidersProps) {
  const [authReady, setAuthReady] = useState(false);
  const [queryClient] = useState(() => {
    const client = getQueryClient();
    if (initialSchools && !client.getQueryData(queryKeys.schools.directory())) {
      client.setQueryData(queryKeys.schools.directory(), initialSchools);
    }
    return client;
  });

  useEffect(() => {
    const handleLogin = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.user.all });
    };
    const handleLogout = () => {
      queryClient.removeQueries({ queryKey: queryKeys.user.all });
      queryClient.removeQueries({ queryKey: queryKeys.admin.all });
      queryClient.removeQueries({ queryKey: queryKeys.goingEvents.all });
      queryClient.removeQueries({
        queryKey: queryKeys.notificationPreferences.all,
      });
      queryClient.removeQueries({ queryKey: queryKeys.posters.all });
      queryClient.removeQueries({ queryKey: queryKeys.posterPayouts.all });
    };
    window.addEventListener("auth-user-login", handleLogin);
    window.addEventListener("auth-user-logout", handleLogout);
    return () => {
      window.removeEventListener("auth-user-login", handleLogin);
      window.removeEventListener("auth-user-logout", handleLogout);
    };
  }, [queryClient]);

  useEffect(() => {
    async function initLanguage() {
      try {
        const initialLang = getStoredLanguage(initialSchools?.find((school) => school.slug === initialSchool)?.language ?? "en");
        await loadLanguage(initialLang);
        await i18n.changeLanguage(initialLang);
      } catch (err) {
        console.error("Language initialization failed, falling back to English:", err);
        await i18n.changeLanguage("en");
      }
    }

    void initLanguage();
  }, [initialSchool, initialSchools]);

  // Not chained behind the language load: restoring the session is a network
  // round trip, and every millisecond it waits is a millisecond the UI is
  // guessing about the signed-in state. They are unrelated, so they race.
  useEffect(() => {
    void queryClient.prefetchQuery(appConstantsQueryOptions());
    let cancelled = false;
    void bootstrapAuth().then(() => {
      if (!cancelled) {
        setAuthReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <TooltipProvider delayDuration={0}>
          <RequestSchoolContext.Provider value={initialSchool}>
            <AuthReadyContext.Provider value={authReady}>
              <Suspense fallback={null}>
                <NavigationProgress />
              </Suspense>
              {DevClickToComponent ? (
                <Suspense fallback={null}>
                  <DevClickToComponent />
                </Suspense>
              ) : null}
              {children}
            </AuthReadyContext.Provider>
          </RequestSchoolContext.Provider>
        </TooltipProvider>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}
