/**
 * Interests step component for onboarding
 */

import { Field, FieldLabel } from "@/shared/ui/field";
import { MultiSelect } from "@/shared/ui/multi-select";
import { OnboardingStepWrapper } from "@/features/auth/components/OnboardingStepWrapper";
import { availableInterests } from "@/shared/data/interests";
import { useTranslation } from "react-i18next";

interface OnboardingInterestsStepProps {
  selectedInterests: string[];
  onToggleInterest: (interest: string) => void;
  onPrevious: () => void;
  onNext: () => void;
}

export function OnboardingInterestsStep({
  selectedInterests,
  onToggleInterest,
  onPrevious,
  onNext,
}: OnboardingInterestsStepProps) {
  const { t } = useTranslation();

  return (
    <OnboardingStepWrapper
      title={t("settings.profile.selectInterests")}
      description={t("modals.interests.description")}
      onPrevious={onPrevious}
      onNext={onNext}
      nextDisabled={selectedInterests.length === 0}
      footerClassName="flex flex-col gap-2 sm:flex-col"
    >
      <Field className="mb-6">
        <FieldLabel className="text-sm font-medium text-foreground sr-only">
          {t("settings.profile.interests")}
        </FieldLabel>
        <MultiSelect
          options={availableInterests}
          selected={selectedInterests}
          onToggle={onToggleInterest}
          translationKeyPrefix="categories"
        />
      </Field>
    </OnboardingStepWrapper>
  );
}
