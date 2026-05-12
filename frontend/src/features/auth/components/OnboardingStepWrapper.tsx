/**
 * Reusable wrapper component for onboarding steps
 * Reduces Tailwind class duplication
 */

import type { ReactNode } from "react";
import { DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

interface OnboardingStepWrapperProps {
  title: string;
  description: string;
  children: ReactNode;
  onNext?: () => void;
  onPrevious?: () => void;
  nextDisabled?: boolean;
  nextLabel?: string;
  showBack?: boolean;
  footerClassName?: string;
}

export function OnboardingStepWrapper({
  title,
  description,
  children,
  onNext,
  onPrevious,
  nextDisabled = false,
  nextLabel,
  showBack = true,
  footerClassName,
}: OnboardingStepWrapperProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col">
      <DialogHeader className="space-y-2 mb-6 text-center">
        <DialogTitle className="text-xl text-center">{title}</DialogTitle>
        <DialogDescription className="text-center">{description}</DialogDescription>
      </DialogHeader>

      {children}

      <DialogFooter className={footerClassName}>
        {showBack && onPrevious && (
          <Button
            variant="secondary"
            onClick={onPrevious}
            className="flex-1 text-muted-foreground"
          >
            <ChevronLeft className="size-4 mr-1 text-muted-foreground" />
            {t("common.back")}
          </Button>
        )}
        {onNext && (
          <Button onClick={onNext} disabled={nextDisabled} className="flex-1">
            {nextLabel || t("common.continue")}
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}
