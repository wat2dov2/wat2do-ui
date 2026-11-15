/**
 * Google Analytics sees the site only through this module, and each page only
 * as `analyticsUrl` describes it: never a query value or path segment that
 * signs someone in or names them. Page titles never carry those values either:
 * every title on those routes comes from `getRouteDocumentTitle`, which names
 * the route, never its parameters.
 *
 * gtag.js sends none of its own page views: `startAnalytics` turns off the one
 * it sends on load, and the web stream's enhanced measurement must keep "Page
 * changes based on browser history events" off, since gtag.js sends those with
 * the raw URL whatever the page asks. `trackPageView` records every page.
 */

import { ROUTES, ticketOrderPath, ticketPath } from "@/shared/constants/routes";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

/**
 * The query parameters Google Analytics may see: campaign tags, which whoever
 * shares a link writes once for everyone who opens it, and which GA reads from
 * the page URL to credit the visit. Every other parameter is dropped, since
 * any may carry a secret: sign-in links carry `token` and `email`, `returnTo`
 * holds the private page that sent someone to sign in, and poster links name
 * their poster.
 */
const CAMPAIGN_PARAMETERS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
]);

/**
 * Paths that end in a secret or in an id naming a person, and what GA sees in
 * its place, longest prefix first so an order is never read as a ticket code.
 * A ticket's code lets whoever holds it in, an order is one person's purchase,
 * an invitation or claim link hands its opener a club, and a poster's QR code
 * names the promoter it pays.
 */
const PRIVATE_PATHS: readonly (readonly [prefix: string, placeholder: string])[] = [
  [ticketOrderPath(""), ":orderId"],
  [ticketPath(""), ":code"],
  [`${ROUTES.INVITE}/`, ":token"],
  [`${ROUTES.CLAIM}/`, ":token"],
  [`${ROUTES.QR}/`, ":code"],
];

/** `pathname` with its private part replaced, matched in any case: a mistyped link still carries its secret. */
function analyticsPath(pathname: string): string {
  const path = pathname.replace(/\/{2,}/g, "/");
  const lowerCasePath = path.toLowerCase();
  const privatePath = PRIVATE_PATHS.find(
    ([prefix]) => lowerCasePath.startsWith(prefix) && lowerCasePath.length > prefix.length,
  );
  if (!privatePath) return path;
  const [prefix, placeholder] = privatePath;
  return `${prefix}${placeholder}`;
}

/**
 * `url` as Google Analytics may see it: its origin and path, with a private
 * path's secret replaced (`PRIVATE_PATHS`), and only the campaign tags of its
 * query (`CAMPAIGN_PARAMETERS`). An empty referrer, or anything else that is
 * not a URL, is "".
 */
export function analyticsUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  const campaign = new URLSearchParams();
  parsed.searchParams.forEach((value, key) => {
    if (CAMPAIGN_PARAMETERS.has(key)) campaign.append(key, value);
  });
  const query = campaign.toString();
  return `${parsed.protocol}//${parsed.host}${analyticsPath(parsed.pathname)}${query ? `?${query}` : ""}`;
}

/** Google's `gtag()`: gtag.js runs only the arguments objects it finds in `dataLayer`. */
const gtag: (...command: unknown[]) => void = function () {
  window.dataLayer ??= [];
  // eslint-disable-next-line prefer-rest-params -- gtag.js reads a command only as an arguments object.
  window.dataLayer.push(arguments);
};

/** Start Google Analytics with its own page views off, so `trackPageView` records each one. */
export function startAnalytics(measurementId: string): void {
  gtag("js", new Date());
  gtag("config", measurementId, { send_page_view: false });
}

/**
 * Record a view of the page at `href`, reached from `referrer`, both as
 * `analyticsUrl` describes them. The events gtag.js sends itself afterwards
 * (scrolls, outbound clicks) report the same page. Returns the location GA
 * saw: the next page's referrer.
 */
export function trackPageView(href: string, referrer: string): string {
  const page = { page_location: analyticsUrl(href), page_referrer: analyticsUrl(referrer) };
  gtag("set", page);
  gtag("event", "page_view", page);
  return page.page_location;
}
