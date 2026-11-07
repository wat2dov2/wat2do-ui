import { DiscoveryLoading } from "@/app/routes/DiscoveryLoading";

/**
 * The clubs page before its data arrives. A loading file per list route keeps its
 * skeleton in that route's own code, ready before the page hydrates.
 *
 * Lives in the (list) route group with the list page, so it never stands in for
 * /clubs/[id] or other routes under /clubs: a client navigation to a detail page shows
 * that page's own loading state, not this list's, and nothing jumps when it swaps.
 */
export default function Loading() {
  return <DiscoveryLoading resource="clubs" />;
}
