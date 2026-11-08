import { STORAGE_KEYS } from "@/shared/constants/storageKeys";

/**
 * Runs in <head> before first paint: marks `<html data-session="signed-in">`
 * when this browser holds a cached sign-in, the same fact `useAuthState`
 * reads (a cached email), and `data-session-avatar` when that sign-in has a
 * picture. `SessionView` shows its signed-in look from these attributes until
 * the page has hydrated, so the server's HTML, which cannot know who is
 * visiting, never paints the signed-out look for a signed-in visitor. The
 * class names that read them spell the same attributes.
 */
export const sessionInitScript = `
(function() {
  try {
    var email = localStorage.getItem(${JSON.stringify(STORAGE_KEYS.USER_EMAIL)});
    if (!email || !JSON.parse(email)) return;
    document.documentElement.setAttribute("data-session", "signed-in");
    var profile = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEYS.USER_PROFILE)}) || "null");
    if (profile && profile.avatarUrl) document.documentElement.setAttribute("data-session-avatar", "");
  } catch (error) {}
})();
`;
