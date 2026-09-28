"use client";

import { useSyncExternalStore } from "react";
import i18n from "@/shared/lib/i18n";
import { Skeleton } from "@/shared/ui/skeleton";
import { FormGrid } from "@/shared/layout/form-grid";
import { Stack } from "@/shared/layout/stack";
import { Table, TableBody, TableSkeletonRows } from "@/shared/ui/table";
import { cn } from "@/shared/lib/utils";

function subscribeToLanguage(onChange: () => void) {
  i18n.on("languageChanged", onChange);
  return () => { i18n.off("languageChanged", onChange); };
}

const loadingLabel = () => i18n.t("common.loading");
const serverLoadingLabel = () => i18n.t("common.loading", { lng: "en" });

export interface LoadingPageProps {
  className?: string;
  /** Override the accessible label (default: "Loading...") */
  label?: string;
  variant?: "content" | "cards" | "table" | "form" | "detail";
}

/**
 * Skeletons for the unknown part of a page or section.
 * Keep known headings, navigation, labels, and actions outside this boundary.
 */
export function LoadingPage({
  className,
  label,
  variant = "content",
}: LoadingPageProps) {
  const translatedLabel = useSyncExternalStore(subscribeToLanguage, loadingLabel, serverLoadingLabel);
  const text = label ?? translatedLabel;

  return (
    <div
      data-slot="loading-page"
      className={cn(
        "w-full py-4",
        className
      )}
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={text}
    >
      <div aria-hidden="true">
        {variant === "table" ? (
          <Table><TableBody><TableSkeletonRows columns={4} /></TableBody></Table>
        ) : variant === "cards" ? (
          <FormGrid columns={3}>
            {Array.from({ length: 6 }, (_, index) => (
              <Stack key={index} gap={3}>
                <Skeleton className="aspect-video w-full rounded-xl" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </Stack>
            ))}
          </FormGrid>
        ) : variant === "form" ? (
          <FormGrid columns={2}>
            {Array.from({ length: 6 }, (_, index) => (
              <Stack key={index} gap={2}>
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-11 w-full rounded-xl" />
              </Stack>
            ))}
          </FormGrid>
        ) : variant === "detail" ? (
          <FormGrid columns={2}>
            <Skeleton className="aspect-square w-full rounded-xl" />
            <Stack gap={6}>
              <Skeleton className="h-8 w-4/5" />
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-5 w-2/3" />
            </Stack>
          </FormGrid>
        ) : (
          <Stack gap={6}>
            {Array.from({ length: 3 }, (_, index) => (
              <Stack key={index} gap={3}>
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </Stack>
            ))}
          </Stack>
        )}
      </div>
    </div>
  );
}
