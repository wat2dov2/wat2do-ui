import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/shared/ui/skeleton";

/** Both exploration views own the same responsive viewport and themed surface. */
export function EventViewSurface(props: ComponentProps<"div">) {
  return <div data-slot="event-view-surface" className="relative h-[min(75vh,44rem)] min-h-96 w-full overflow-hidden rounded-xl border border-border bg-surface text-foreground" {...props} />;
}

export function EventViewSkeleton() {
  const { t } = useTranslation();
  return <EventViewSurface role="status" aria-label={t("common.loading")}><Skeleton className="h-full w-full" /></EventViewSurface>;
}
