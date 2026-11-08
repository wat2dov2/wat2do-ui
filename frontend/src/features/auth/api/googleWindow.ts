import { completeGoogleOAuthAPI, getGoogleOAuthStartUrl } from "@/features/auth/api/auth.api";
import { hasSessionCookie } from "@/features/auth/api/userRepository";
import { ROUTES } from "@/shared/constants/routes";

/** Pages on this site tell each other here that a sign-in window has finished. */
const SIGNED_IN_CHANNEL = "wat2do-signed-in";
/** How often a page waiting on a sign-in window looks for the session it leaves. */
const SESSION_CHECK_MS = 1000;
const WINDOW_WIDTH = 500;
const WINDOW_HEIGHT = 640;

/** The browser refused to open the sign-in window. */
export class SignInWindowBlockedError extends Error {
  constructor() {
    super("The browser blocked the sign-in window");
  }
}

/** Sent by the sign-in window's last page, once its session exists. */
export function announceSignedIn(): void {
  const channel = new BroadcastChannel(SIGNED_IN_CHANNEL);
  channel.postMessage("signed-in");
  channel.close();
}

function openSignInWindow(url: string): Window | null {
  const left = Math.round(window.screenX + (window.outerWidth - WINDOW_WIDTH) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - WINDOW_HEIGHT) / 2);
  return window.open(
    url,
    "wat2do-google-sign-in",
    `popup,width=${WINDOW_WIDTH},height=${WINDOW_HEIGHT},left=${left},top=${top}`,
  );
}

/**
 * Google sign-in in a window of its own, so the page that asked keeps its
 * state (a half-filled form). Resolves once this page is signed in too.
 *
 * The window's last page announces the new session. The session cookie it
 * leaves is checked as well, every second and whenever this page regains
 * focus, because a phone may pause this page while the visitor is in the
 * other tab and miss the announcement.
 */
export function signInWithGoogleWindow(signal: AbortSignal): Promise<void> {
  if (!openSignInWindow(getGoogleOAuthStartUrl(ROUTES.AUTH_SIGNED_IN))) {
    return Promise.reject(new SignInWindowBlockedError());
  }
  // A cookie this browser already held says nothing about the new window.
  const hadSession = hasSessionCookie();
  return new Promise<void>((resolve, reject) => {
    const channel = new BroadcastChannel(SIGNED_IN_CHANNEL);
    let settled = false;
    const stop = () => {
      settled = true;
      channel.close();
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
    };
    const finish = () => {
      if (settled) return;
      stop();
      completeGoogleOAuthAPI().then(() => resolve(), reject);
    };
    function check() {
      if (!hadSession && hasSessionCookie()) finish();
    }
    const timer = window.setInterval(check, SESSION_CHECK_MS);
    channel.onmessage = finish;
    window.addEventListener("focus", check);
    signal.addEventListener(
      "abort",
      () => {
        if (settled) return;
        stop();
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
