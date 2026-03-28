import { Button } from "@/shared/ui/button";

interface OnboardingYearStepProps {
  isFirstYear: boolean | null;
  onSelectYear: (value: boolean) => void;
}

export function OnboardingYearStep({
  isFirstYear,
  onSelectYear,
}: OnboardingYearStepProps) {
  return (
    <div className="flex flex-col items-center space-y-4 max-w-sm mx-auto">
      <div className="flex gap-2 w-full">
        <Button
          type="button"
          variant={isFirstYear === true ? "default" : "secondary"}
          onClick={() => onSelectYear(true)}
          className="flex-1"
        >
          Yep, brand new!
        </Button>
        <Button
          type="button"
          variant={isFirstYear === false ? "default" : "secondary"}
          onClick={() => onSelectYear(false)}
          className="flex-1"
        >
          Nope, been here
        </Button>
      </div>
    </div>
  );
}
