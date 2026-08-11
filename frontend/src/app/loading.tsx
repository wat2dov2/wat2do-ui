import { LoadingPage } from "@/shared/ui/loading-page";

/** One loading boundary for every route rendered inside the persistent shell. */
export default function Loading() {
  return <LoadingPage className="min-h-[60dvh]" />;
}
