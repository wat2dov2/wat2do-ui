import { useTranslation } from "react-i18next";
import { GooseLoadingAnimation } from "@/shared/ui/goose-loading-animation";
import { cn } from "@/shared/lib/utils";

export interface LoadingPageProps {
  className?: string;
  /** Override the label (default: "Loading...") */
  label?: string;
  /** @deprecated LoadingPage now uses the goose animation instead of a spinner. */
  spinnerClassName?: string;
}

/**
 * Standardized full-page or section loading UI.
 * Use wherever a page or section is loading (events, clubs, admin, Suspense fallback, etc.).
 */
export function LoadingPage({
  className,
  label,
}: LoadingPageProps) {
  const { t } = useTranslation();
  const text = label ?? (t("common.loading") || "Loading...");

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-24",
        className
      )}
      role="status"
      aria-live="polite"
      aria-label={text}
    >
      <GooseLoadingAnimation />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
