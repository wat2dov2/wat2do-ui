import * as React from "react";
import { useTranslation } from "react-i18next";
import { Spinner } from "@/shared/ui/spinner";
import { cn } from "@/shared/lib/utils";

export interface LoadingPageProps {
  className?: string;
  /** Override the label (default: "Loading...") */
  label?: string;
  /** Spinner size via Tailwind (default: size-8) */
  spinnerClassName?: string;
}

/**
 * Standardized full-page or section loading UI: Spinner and "Loading..." side by side, centered.
 * Use wherever a page or section is loading (events, clubs, admin, Suspense fallback, etc.).
 */
export function LoadingPage({
  className,
  label,
  spinnerClassName = "size-4",
}: LoadingPageProps) {
  const { t } = useTranslation();
  const text = label ?? (t("common.loading") || "Loading...");

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 py-24",
        className
      )}
      role="status"
      aria-live="polite"
      aria-label={text}
    >
      <Spinner className={spinnerClassName} />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
