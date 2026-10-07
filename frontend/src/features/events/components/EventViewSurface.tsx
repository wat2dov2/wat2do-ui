import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/shared/ui/skeleton";

type EventViewSurfaceProps = ComponentProps<"div"> & { variant?: "calendar" | "map" };

/** Exploration views share one themed surface; the map has a taller viewport. */
export function EventViewSurface({ variant = "calendar", ...props }: EventViewSurfaceProps) {
  return <div data-slot="event-view-surface" data-view={variant} className={`relative w-full overflow-hidden rounded-xl border border-border bg-surface text-foreground ${variant === "map" ? "h-[min(85dvh,56rem)] min-h-[32rem]" : "h-[min(75vh,44rem)] min-h-96"}`} {...props} />;
}

export function EventViewSkeleton({ variant }: Pick<EventViewSurfaceProps, "variant">) {
  const { t } = useTranslation();
  return <EventViewSurface variant={variant} role="status" aria-label={t("common.loading")}><Skeleton className="h-full w-full" /></EventViewSurface>;
}
