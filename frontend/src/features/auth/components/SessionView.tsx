"use client";

import type { ReactNode } from "react";
import { useAuthState, useSessionKnown } from "@/features/auth/hooks/useAuthState";

interface SessionViewProps {
  signedIn: ReactNode;
  signedOut: ReactNode;
}

/**
 * One of two looks, by whether this browser holds a session.
 *
 * The server cannot know who is visiting, so its HTML (and the hydration that
 * follows) draws both looks, and the `data-session` attribute that
 * `sessionInitScript` puts on <html> before first paint shows the right one.
 * Once the session is known only that look is drawn. A page therefore never
 * swaps its signed-out look for its signed-in one after it has painted.
 *
 * Each look sits in a `display: contents` box, so it lays out exactly as
 * children of the parent would; the keys keep the shown look mounted when the
 * other is dropped.
 */
export function SessionView({ signedIn, signedOut }: SessionViewProps) {
  const known = useSessionKnown();
  const { isAuthenticated } = useAuthState();
  return (
    <>
      {!known || isAuthenticated ? (
        <div key="signed-in" className={known ? "contents" : "hidden in-data-[session=signed-in]:contents"}>
          {signedIn}
        </div>
      ) : null}
      {!known || !isAuthenticated ? (
        <div key="signed-out" className={known ? "contents" : "contents in-data-[session=signed-in]:hidden"}>
          {signedOut}
        </div>
      ) : null}
    </>
  );
}
