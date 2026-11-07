"use client";

import { lazy, Suspense } from "react";
import { usePathname } from "next/navigation";
import { ClubPanelEventTicketsLoading } from "@/features/club-panel/components/ClubPanelEventHeader";
import { ROUTES } from "@/shared/constants/routes";
import { Container } from "@/shared/layout/container";
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
/**
 * Shared by native route streaming, lazy route chunks, and auth gates.
 * The events, clubs and positions lists and the event and club pages have
 * their own loading files, so their skeletons ship with their routes and are
 * ready before hydration: a lazy skeleton that is still downloading when the
 * page hydrates is dropped and leaves the screen blank. Until their own
 * loading state streams in, this one draws nothing, so nothing appears only
 * to be replaced.
 */
const OWN_LOADING_ROUTE = /^\/(?:events|clubs|positions|events\/\d+|clubs\/\d+)\/?$/;
/** One event's ticket page in the club panel, whose header is known before its data. */
const CLUB_PANEL_EVENT_ROUTE = /^\/club-panel\/events\/(\d+)\/?$/;

export function RouteLoading() {
  const pathname = usePathname();
  if (pathname === ROUTES.LANDING_PREVIEW) return <Suspense><LandingPage snapshot={null} /></Suspense>;
  if (pathname === ROUTES.ABOUT) return <Suspense><AboutPage isLoading /></Suspense>;
  if (pathname === ROUTES.LOGIN) return <Suspense><LoginLoading /></Suspense>;
  if (OWN_LOADING_ROUTE.test(pathname)) return null;
  if (pathname in PAGE_SHELLS) return <PageShellLoading route={pathname} />;
  const clubPanelEvent = CLUB_PANEL_EVENT_ROUTE.exec(pathname);
  if (clubPanelEvent) {
    return (
      <Container size="md">
        <ClubPanelEventTicketsLoading eventId={Number(clubPanelEvent[1])} />
      </Container>
    );
  }
  // A page's width belongs to its container, so a loading page never runs edge to edge.
  return <Container><LoadingPage /></Container>;
}
