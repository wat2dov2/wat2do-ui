import { RouteLoading } from "@/app/routes/RouteLoading";

/** One loading boundary for every route rendered inside the persistent shell. */
export default function Loading() {
  return <RouteLoading />;
}
