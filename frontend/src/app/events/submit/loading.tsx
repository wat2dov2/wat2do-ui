import { RouteLoading } from "@/app/routes/RouteLoading";

/** Keeps this page on the shared loading state rather than its parent list's skeleton. */
export default function Loading() {
  return <RouteLoading />;
}
