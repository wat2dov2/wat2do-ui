import { STORAGE_KEYS } from "@/shared/constants/storageKeys";

/**
 * Runs in <head> before first paint and marks <html> from the cached sign-in,
 * the same facts `useAuthState` reads:
 * - `data-session="signed-in"` when a sign-in is cached (a cached email);
 * - `data-session-avatar` when it has a picture;
 * - `data-session-admin` for an admin;
 * - for each club the visitor runs, a rule showing `[data-manager-for="<id>"]`.
 *
 * `SessionView` and `ClubManagerView` read these until the page has hydrated,
 * so the server's HTML, which cannot know who is visiting, never paints the
 * signed-out look (or hides a club team's controls) for a visitor it then
 * swaps. The class names that read them spell the same attributes.
 */
export const sessionInitScript = `
(function() {
  try {
    var root = document.documentElement;
    var email = localStorage.getItem(${JSON.stringify(STORAGE_KEYS.USER_EMAIL)});
    if (!email || !JSON.parse(email)) return;
    root.setAttribute("data-session", "signed-in");
    var profile = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEYS.USER_PROFILE)}) || "null");
    if (!profile) return;
    if (profile.avatarUrl) root.setAttribute("data-session-avatar", "");
    if (profile.role === "admin") root.setAttribute("data-session-admin", "");
    var rules = (profile.clubs || [])
      .map(function(club) { return Number(club && club.id); })
      .filter(function(id) { return Number.isInteger(id) && id > 0; })
      .map(function(id) { return '[data-manager-for="' + id + '"]{display:contents!important}'; });
    if (rules.length) {
      var style = document.createElement("style");
      style.textContent = rules.join("");
      document.head.appendChild(style);
    }
  } catch (error) {}
})();
`;
