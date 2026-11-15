/**
 * Opens every newly visited page at the top of AppLayout's main content
 * scroller. Pages scroll inside that element, not the window, so Next's own
 * scroll-to-top on navigation never resets it.
 */

import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { MAIN_CONTENT_SCROLL_ROOT_SELECTOR } from "@/shared/constants/ui";

type PageLocation = Pick<Location, "pathname" | "hash">;

/**
 * Whether the page just navigated to should open at the top. Back and forward
 * (`traversedTo`, the pathname a history traversal landed on) keep the browser's
 * position, and a link to a section (`#hash`) is left for Next to scroll to.
 */
export function opensAtTop(location: PageLocation, traversedTo: string | null): boolean {
  return location.hash === "" && location.pathname !== traversedTo;
}

/** Resets the main scroller when the pathname changes; query-only changes keep it. */
export function useScrollTopOnNavigate(): void {
  const pathname = usePathname();
  const previousPathname = useRef(pathname);
  const traversedTo = useRef<string | null>(null);

  useEffect(() => {
    const recordTraversal = () => {
      traversedTo.current = window.location.pathname;
    };
    window.addEventListener("popstate", recordTraversal);
    return () => window.removeEventListener("popstate", recordTraversal);
  }, []);

  // A layout effect runs before paint and after Next's own scroll handling in
  // the new page, so the old position never shows and nothing undoes the reset.
  useLayoutEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    const traversal = traversedTo.current;
    traversedTo.current = null;
    if (!opensAtTop(window.location, traversal)) return;
    document
      .querySelector<HTMLElement>(MAIN_CONTENT_SCROLL_ROOT_SELECTOR)
      ?.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);
}
