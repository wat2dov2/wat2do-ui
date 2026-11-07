"use client";

import { lazy, Suspense } from "react";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { EventDetailsBodySkeleton } from "@/features/events/components/EventDetailsDrawerSkeleton";
import { Container, PageHeader, Stack } from "@/shared/layout";
import { ROUTES } from "@/shared/constants/routes";
import { LoadingPage, PageShellLoading } from "@/shared/ui/loading-page";
import { PAGE_SHELLS } from "@/shared/constants/pageShells";

/*
 * Whole-page loading states for pages few visits start from. They are the
 * real pages (or their own skeletons) and carry those pages' code, so they
 * load on demand instead of riding along in every route's first download.
 */
const AboutPage = lazy(() =>
  import("@/features/contact/pages/AboutPage").then((module) => ({ default: module.AboutPage })),
);
const LandingPage = lazy(() =>
  import("@/features/landing/pages/LandingPage").then((module) => ({ default: module.LandingPage })),
);
const LoginLoading = lazy(async () => {
  const [{ AuthEntryPage }, { AuthHeroPanel }] = await Promise.all([
    import("@/features/auth/pages/AuthEntryPage"),
    import("@/features/auth/components/AuthHeroPanel"),
  ]);
  return {
    default: function LoginLoadingState() {
      return <AuthEntryPage isPending preview={<AuthHeroPanel isLoading />} />;
    },
  };
});
/** The events, clubs and positions lists' loading state; those pages are also warmed in idle time. */
const DiscoveryLoading = lazy(() =>
  import("@/app/routes/DiscoveryLoading").then((module) => ({ default: module.DiscoveryLoading })),
);
const ClubDetailsSkeleton = lazy(() =>
  import("@/features/clubs/components/ClubDetailsSkeleton").then((module) => ({
    default: module.ClubDetailsSkeleton,
  })),
);

/** Shared by native route streaming, lazy route chunks, and auth gates. */
export function RouteLoading() {
  const pathname = usePathname();
  const { t } = useTranslation();
  if (pathname === ROUTES.LANDING_PREVIEW) return <Suspense><LandingPage snapshot={null} /></Suspense>;
  if (pathname === ROUTES.ABOUT) return <Suspense><AboutPage isLoading /></Suspense>;
  if (pathname === ROUTES.LOGIN) return <Suspense><LoginLoading /></Suspense>;
  if (pathname === ROUTES.EVENTS) return <Suspense><DiscoveryLoading resource="events" /></Suspense>;
  if (pathname === ROUTES.CLUBS) return <Suspense><DiscoveryLoading resource="clubs" /></Suspense>;
  if (pathname === ROUTES.POSITIONS) return <Suspense><DiscoveryLoading resource="positions" /></Suspense>;
  if (/^\/clubs\/\d+\/?$/.test(pathname)) return <Suspense><ClubDetailsSkeleton /></Suspense>;
  if (/^\/events\/\d+\/?$/.test(pathname)) {
    return <Container size="lg"><Stack gap={6}>
      <PageHeader back={{ href: ROUTES.EVENTS, label: t("events.allEvents") }} />
      <EventDetailsBodySkeleton />
    </Stack></Container>;
  }
  if (pathname in PAGE_SHELLS) return <PageShellLoading route={pathname} />;
  return <LoadingPage />;
}
