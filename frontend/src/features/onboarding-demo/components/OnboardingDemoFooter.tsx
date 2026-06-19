import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

interface OnboardingDemoFooterProps {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  showBack?: boolean;
  secondaryAction?: ReactNode;
  className?: string;
}

export function OnboardingDemoFooter({
  onBack,
  onNext,
  nextLabel,
  nextDisabled = false,
  showBack = true,
  secondaryAction,
  className,
}: OnboardingDemoFooterProps) {
  const { t } = useTranslation();
  const resolvedNextLabel = nextLabel ?? t("onboardingDemo.actions.continue");

  return (
    <div className={cn("flex items-center justify-between gap-4 w-full", className)}>
      <div className="flex items-center gap-3">
        {showBack && onBack && (
          <Button type="button" variant="ghost" onClick={onBack}>
            {t("onboardingDemo.actions.back")}
          </Button>
        )}
        {secondaryAction}
      </div>
      <Button type="button" onClick={onNext} disabled={nextDisabled}>
        {resolvedNextLabel}
      </Button>
    </div>
  );
}
