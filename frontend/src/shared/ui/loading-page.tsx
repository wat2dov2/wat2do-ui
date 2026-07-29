import { useTranslation } from "react-i18next";
import { GooseLoadingAnimation } from "@/shared/ui/goose-loading-animation";
import { cn } from "@/shared/lib/utils";

export interface LoadingPageProps {
  className?: string;
  /** Override the accessible label (default: "Loading...") */
  label?: string;
}

/**
 * Standardized full-page or section loading UI.
 * Use wherever a page or section is loading (events, organizations, admin, Suspense fallback, etc.).
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
    </div>
  );
}
