"use client";

import { createContext, lazy, Suspense, useContext, useEffect, useState, type ReactNode } from "react";
import { LazyMotion, domMax } from "framer-motion";
import "@/shared/lib/i18n";
import i18n, { getStoredLanguage } from "@/shared/lib/i18n";
import { loadLanguage } from "@/shared/lib/loadLanguage";
import ErrorBoundary from "@/app/ErrorBoundary";
import { fetchProfileAPI, initializeAuth } from "@/features/auth/api/auth.api";
import { loadAppConstants } from "@/shared/api/metaApi";
import { initClarity } from "@/shared/lib/clarity";
import { initGoogleAnalytics } from "@/shared/lib/googleAnalytics";
import { setOnAfterRefresh } from "@/shared/services/apiClient";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { installBundledLocales } from "@/app/localeResources";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

installBundledLocales();

const Analytics = lazy(() =>
  import("@vercel/analytics/react").then((module) => ({
    default: module.Analytics,
  })),
);

const DevClickToComponent =
  process.env.NODE_ENV === "development"
    ? lazy(() =>
        import("click-to-react-component").then((module) => ({
          default: module.ClickToComponent,
        })),
      )
    : null;

const AppReadyContext = createContext(false);

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

async function bootstrapAuth() {
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
  } catch (err) {
    console.error("Auth initialization failed or timed out, continuing without session:", err);
  }
}

function shouldRenderVercelAnalytics() {
  if (typeof window === "undefined") return false;
  return !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

export function useAppReady() {
  return useContext(AppReadyContext);
}

export function ClientProviders({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(() => i18n.hasResourceBundle("en", "translation"));
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            staleTime: 1000 * 60 * 5, // 5 minutes default cache TTL
          },
        },
      }),
  );

  useEffect(() => {
    const handleAuth = () => {
      queryClient.clear();
    };
    window.addEventListener("auth-user-login", handleAuth);
    window.addEventListener("auth-user-logout", handleAuth);
    return () => {
      window.removeEventListener("auth-user-login", handleAuth);
      window.removeEventListener("auth-user-logout", handleAuth);
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
        setReady(true);
      }
    }

    void initLanguage();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;

    document.documentElement.dataset.clientReady = "true";
    initClarity(process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID);
    initGoogleAnalytics(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID);
    void bootstrapConstants();
    void bootstrapAuth();

    return () => {
      delete document.documentElement.dataset.clientReady;
    };
  }, [ready]);

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <LazyMotion features={domMax} strict>
          <TooltipProvider delayDuration={0}>
            <AppReadyContext.Provider value={ready}>
              {DevClickToComponent ? (
                <Suspense fallback={null}>
                  <DevClickToComponent />
                </Suspense>
              ) : null}
              {children}
              {shouldRenderVercelAnalytics() ? (
                <Suspense fallback={null}>
                  <Analytics />
                </Suspense>
              ) : null}
            </AppReadyContext.Provider>
          </TooltipProvider>
        </LazyMotion>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}
