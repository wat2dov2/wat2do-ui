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

interface ClubManagerViewProps {
  /** The club whose team sees these controls; admins see them for every club unless `admins` is false. */
  clubId: number | null | undefined;
  /**
   * False for controls only the club's own team sees, even when the visitor is an
   * admin (managing tickets, which happens in that club's panel).
   */
  admins?: boolean;
  children: ReactNode;
}

/**
 * Controls only a club's own team and admins see (edit, delete), or with
 * `admins={false}` only the club's own team (manage tickets).
 *
 * Like `SessionView`, the server's HTML draws them hidden and
 * `sessionInitScript` shows them before first paint for a member of this club
 * (and for an admin unless `admins` is false), so the people who see them see
 * them from the first frame instead of watching them push the page's other
 * controls aside.
 */
export function ClubManagerView({ clubId, admins = true, children }: ClubManagerViewProps) {
  const known = useSessionKnown();
  const { isAdmin, clubs } = useAuthState();
  const manages = (admins && isAdmin) || clubs.some((club) => club.id === clubId);
  if (known && !manages) return null;
  return (
    <div
      data-manager-for={clubId ?? undefined}
      className={known ? "contents" : admins ? "hidden in-data-[session-admin]:contents" : "hidden"}
    >
      {children}
    </div>
  );
}
