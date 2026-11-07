"use client";

import { createContext, useContext } from "react";

/**
 * The open drawer's content element, or null outside a drawer.
 *
 * A drawer locks scrolling to its own subtree, so any overlay that portals to
 * `document.body` lands outside the lock and stops scrolling entirely. Overlays
 * portal into this node instead when there is one, which also lets the drawer's
 * drag handler recognise them as scrollable rather than as a dismiss gesture.
 *
 * It lives apart from the drawer itself so popovers and selects can read it
 * without loading the drawer library.
 */
export const DrawerContentNodeContext = createContext<HTMLElement | null>(null);

export function useDrawerPortalContainer(): HTMLElement | null {
  return useContext(DrawerContentNodeContext);
}
