import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";
import { GraduationCap, BookOpen } from "@/shared/ui/doodle-icons";

interface OnboardingYearStepProps {
  isFirstYear: boolean | null;
  onChange: (value: boolean) => void;
}

export function OnboardingYearStep({
  isFirstYear,
  onChange,
}: OnboardingYearStepProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md mx-auto justify-center">
      <button
        type="button"
        onMouseDown={() => onChange(true)}
        className={cn(
          "flex-1 flex flex-col items-center gap-3 p-6 rounded-2xl border text-center transition-all duration-300",
          "hover:border-primary hover:bg-primary/5 hover:scale-[1.02]",
          isFirstYear === true
            ? "border-primary bg-primary/10 shadow-xs ring-1 ring-primary"
            : "border-border bg-card text-card-foreground"
        )}
      >
        <div className={cn(
          "size-12 rounded-full flex items-center justify-center transition-colors duration-300",
          isFirstYear === true ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
        )}>
          <GraduationCap className="size-6" />
        </div>
        <div className="space-y-1">
          <h3 className="font-semibold text-base text-foreground">
            {t("modals.allSet.firstYear")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("onboarding.year.yesFirstYear")}
          </p>
        </div>
      </button>

      <button
        type="button"
        onMouseDown={() => onChange(false)}
        className={cn(
          "flex-1 flex flex-col items-center gap-3 p-6 rounded-2xl border text-center transition-all duration-300",
          "hover:border-primary hover:bg-primary/5 hover:scale-[1.02]",
          isFirstYear === false
            ? "border-primary bg-primary/10 shadow-xs ring-1 ring-primary"
            : "border-border bg-card text-card-foreground"
        )}
      >
        <div className={cn(
          "size-12 rounded-full flex items-center justify-center transition-colors duration-300",
          isFirstYear === false ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
        )}>
          <BookOpen className="size-6" />
        </div>
        <div className="space-y-1">
          <h3 className="font-semibold text-base text-foreground">
            {t("modals.allSet.returningStudent")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("onboarding.year.noReturning")}
          </p>
        </div>
      </button>
    </div>
  );
}
