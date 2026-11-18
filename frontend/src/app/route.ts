import { ROUTES } from "@/shared/constants/routes";

/**
 * The root opens the events feed with its query. The redirect is permanent
 * (308) so search engines index the feed in the root's place, and `no-store`
 * so browsers ask again every visit and the root can change role later
 * without stale redirects. A `next.config.ts` redirect cannot carry that
 * header: the deployed server (OpenNext) answers those with Location alone.
 */
export function GET(request: Request): Response {
  return new Response(null, {
    status: 308,
    headers: {
      Location: `${ROUTES.EVENTS}${new URL(request.url).search}`,
      "Cache-Control": "no-store",
    },
  });
}
