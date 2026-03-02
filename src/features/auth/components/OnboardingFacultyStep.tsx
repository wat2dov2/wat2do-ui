import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { FACULTY_OPTIONS } from "@/features/auth/hooks/useOnboardingFlow";

interface OnboardingFacultyStepProps {
  faculty: string;
  onFacultyChange: (value: string) => void;
}

export function OnboardingFacultyStep({
  faculty,
  onFacultyChange,
}: OnboardingFacultyStepProps) {
  return (
    <div className="flex flex-col items-center space-y-4 max-w-sm mx-auto">
      <Select value={faculty} onValueChange={onFacultyChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select your faculty" />
        </SelectTrigger>
        <SelectContent>
          {FACULTY_OPTIONS.map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
