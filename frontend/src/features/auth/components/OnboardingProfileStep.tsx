/**
 * Profile step component for onboarding (faculty & first year)
 */

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Field, FieldGroup, FieldLabel } from "@/shared/ui/field";
import { Button } from "@/shared/ui/button";
import { OnboardingStepWrapper } from "@/features/auth/components/OnboardingStepWrapper";
import { useTranslation } from "react-i18next";

const availableFaculties = [
  "Engineering",
  "Mathematics",
  "Science",
  "Arts",
  "Environment",
  "Health",
  "Applied Health Sciences",
];

interface OnboardingProfileStepProps {
  selectedFaculty: string;
  onFacultyChange: (faculty: string) => void;
  isFirstYear: boolean | null;
  onFirstYearChange: (isFirstYear: boolean) => void;
  onPrevious: () => void;
  onNext: () => void;
}

export function OnboardingProfileStep({
  selectedFaculty,
  onFacultyChange,
  isFirstYear,
  onFirstYearChange,
  onPrevious,
  onNext,
}: OnboardingProfileStepProps) {
  const { t } = useTranslation();

  return (
    <OnboardingStepWrapper
      title={t("modals.profile.title")}
      description={t("modals.profile.description")}
      onPrevious={onPrevious}
      onNext={onNext}
      nextDisabled={!selectedFaculty || isFirstYear === null}
    >
      <FieldGroup className="mb-6">
        <Field>
          <FieldLabel htmlFor="faculty-select" className="text-sm font-medium text-foreground">
            {t("settings.profile.faculty")}
          </FieldLabel>
          <Select value={selectedFaculty} onValueChange={onFacultyChange}>
            <SelectTrigger id="faculty-select" className="w-full">
              <SelectValue placeholder={t("modals.profile.title")} />
            </SelectTrigger>
            <SelectContent>
              {availableFaculties.map((faculty) => {
                const facultyKey = faculty.toLowerCase().replace(/\s+/g, "");
                const translationKey = `onboarding.faculties.${
                  facultyKey === "appliedhealthsciences" ? "appliedHealthSciences" : facultyKey
                }`;
                return (
                  <SelectItem key={faculty} value={faculty}>
                    {t(translationKey) || faculty}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel className="text-sm font-medium text-foreground">
            {t("modals.profile.firstYearQuestion")}
          </FieldLabel>
          <div className="flex gap-2">
            <Button
              onClick={() => onFirstYearChange(true)}
              variant={isFirstYear === true ? "default" : "ghost"}
              className="flex-1"
            >
              {t("common.yes")}
            </Button>
            <Button
              onClick={() => onFirstYearChange(false)}
              variant={isFirstYear === false ? "default" : "ghost"}
              className="flex-1"
            >
              {t("common.no")}
            </Button>
          </div>
        </Field>
      </FieldGroup>
    </OnboardingStepWrapper>
  );
}
