"use client";

import { useSyncExternalStore } from "react";
import i18n from "@/shared/lib/i18n";
import { Skeleton } from "@/shared/ui/skeleton";
import { FormGrid } from "@/shared/layout/form-grid";
import { Stack } from "@/shared/layout/stack";
import { Container } from "@/shared/layout/container";
import { PageShellHeader } from "@/shared/layout/page-shell-header";
import { PAGE_SHELLS } from "@/shared/constants/pageShells";
import { TabsListSkeleton } from "@/shared/ui/tabs";
import { Table, TableBody, TableHead, TableHeader, TableRow, TableSkeletonRows } from "@/shared/ui/table";
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
  variant?: "content" | "cards" | "table" | "form" | "detail" | "dashboard" | "list" | "sections" | "rows" | "upload" | "panel";
  /** How many cards the dashboard variant shows. */
  cards?: number;
}

const TABLE_COLUMNS = 5;

/** One field: its label above an input-height box. */
function FieldSkeleton({ tall = false }: { tall?: boolean }) {
  return (
    <Stack gap={2}>
      <Skeleton className="h-4 w-28" />
      <Skeleton className={cn("w-full rounded-xl", tall ? "h-24" : "h-10")} />
    </Stack>
  );
}

/** A surface card, the frame dashboards, sections and rows all sit in. */
function SurfaceSkeleton({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-xl border border-border bg-surface", className)}>{children}</div>;
}

/**
 * Skeletons for the unknown part of a page or section.
 * Keep known headings, navigation, labels, and actions outside this boundary.
 */
export function LoadingPage({
  className,
  label,
  variant = "content",
  cards = 6,
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
        {variant === "dashboard" ? (
          <FormGrid columns={3}>
            {Array.from({ length: cards }, (_, index) => (
              <SurfaceSkeleton key={index} className="flex flex-col items-start gap-3 p-6">
                <Skeleton className="size-10 rounded-lg" />
                <Skeleton className="h-5 w-2/5" />
                <Skeleton className="h-5 w-32 rounded-full" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="size-4" />
              </SurfaceSkeleton>
            ))}
          </FormGrid>
        ) : variant === "list" ? (
          <Stack gap={4}>
            <Stack direction="horizontal" gap={2}>
              <Skeleton className="h-10 flex-1 rounded-xl" />
              <Skeleton className="h-10 w-28 rounded-xl" />
            </Stack>
            <Stack direction="horizontal" justify="between" align="center">
              <Skeleton className="h-7 w-44" />
              <Skeleton className="h-8 w-24 rounded-xl" />
            </Stack>
            <Table>
              <TableHeader>
                <TableRow>
                  {Array.from({ length: TABLE_COLUMNS }, (_, index) => (
                    <TableHead key={index}><Skeleton className="h-3 w-16 bg-muted-foreground/15" /></TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody><TableSkeletonRows columns={TABLE_COLUMNS} rows={8} /></TableBody>
            </Table>
          </Stack>
        ) : variant === "sections" ? (
          <Stack gap={4}>
            <SurfaceSkeleton className="flex items-center gap-4 p-6">
              <Skeleton className="size-14 rounded-full" />
              <Skeleton className="h-4 w-48" />
            </SurfaceSkeleton>
            <SurfaceSkeleton className="p-6">
              <Stack gap={6}>
                <FieldSkeleton />
                <FieldSkeleton />
                <Stack direction="horizontal" justify="between" align="center">
                  <Stack gap={2}>
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </Stack>
                  <Skeleton className="h-6 w-11 rounded-full" />
                </Stack>
              </Stack>
            </SurfaceSkeleton>
          </Stack>
        ) : variant === "panel" ? (
          <SurfaceSkeleton className="p-6">
            <Stack gap={6}>
              <Stack gap={2}>
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-3/4" />
              </Stack>
              <FieldSkeleton />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-9 w-36 rounded-xl" />
            </Stack>
          </SurfaceSkeleton>
        ) : variant === "upload" ? (
          <SurfaceSkeleton className="p-6">
            <Stack align="center" gap={4}>
              <Stack align="center" gap={2}>
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-64" />
              </Stack>
              <div className="flex aspect-video w-full items-center justify-center rounded-xl border-2 border-dashed border-border">
                <Skeleton className="size-8 rounded-lg" />
              </div>
              <Skeleton className="h-9 w-32 rounded-xl" />
            </Stack>
          </SurfaceSkeleton>
        ) : variant === "rows" ? (
          <Stack gap={2}>
            {Array.from({ length: 3 }, (_, index) => (
              <SurfaceSkeleton key={index} className="flex items-center gap-4 p-4">
                <Skeleton className="size-12 rounded-lg" />
                <Stack gap={2} grow>
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </Stack>
                <Skeleton className="h-8 w-20 rounded-xl" />
              </SurfaceSkeleton>
            ))}
          </Stack>
        ) : variant === "table" ? (
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

/**
 * A route's whole loading state from its shell: the real header in the real
 * container, its tabs, and a skeleton of its body.
 */
export function PageShellLoading({ route }: { route: string }) {
  const shell = PAGE_SHELLS[route];
  const page = (
    <Stack gap={5}>
      <PageShellHeader route={route} />
      {shell.tabs ? <div aria-hidden="true"><TabsListSkeleton count={shell.tabs} /></div> : null}
      <LoadingPage variant={shell.body} cards={shell.cards} className="py-0" />
    </Stack>
  );
  return <Container size={shell.container}>{page}</Container>;
}
