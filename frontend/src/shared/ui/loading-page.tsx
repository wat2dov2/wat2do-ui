"use client";

import { useSyncExternalStore } from "react";
import i18n from "@/shared/lib/i18n";
import { GooseLoadingAnimation } from "@/shared/ui/goose-loading-animation";
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
}

/**
 * Standardized full-page or section loading UI.
 * Use wherever a page or section is loading (events, clubs, admin, Suspense fallback, etc.).
 */
export function LoadingPage({
  className,
  label,
}: LoadingPageProps) {
  const translatedLabel = useSyncExternalStore(subscribeToLanguage, loadingLabel, serverLoadingLabel);
  const text = label ?? translatedLabel;

  return (
    <div
      data-slot="loading-page"
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
