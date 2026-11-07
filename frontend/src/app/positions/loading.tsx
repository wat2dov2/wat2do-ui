import { DiscoveryLoading } from "@/app/routes/DiscoveryLoading";

/**
 * The positions page before its data arrives. A loading file per list route keeps its
 * skeleton in that route's own code, ready before the page hydrates.
 */
export default function Loading() {
  return <DiscoveryLoading resource="positions" />;
}
