import { Button } from "@/shared/ui/button";

interface OnboardingSafetyStepProps {
  onContinue: () => void;
}

export function OnboardingSafetyStep({ onContinue }: OnboardingSafetyStepProps) {
  return (
    <div className="flex flex-col items-center text-center space-y-6 max-w-lg mx-auto">
      <span className="text-3xl leading-none text-primary">✶</span>
      <h1 className="font-sans font-bold text-[28px] leading-tight text-foreground">
        Welcome to your campus events home.
      </h1>
      <p className="text-sm text-muted-foreground leading-relaxed">
        We help you discover what is happening around your school and connect with
        communities that match your interests.
      </p>

      <div className="space-y-3 text-sm text-muted-foreground leading-relaxed text-left w-full">
        <p>Save events, track deadlines, and quickly filter by what matters to you.</p>
        <p>Community and safety safeguards help keep submissions high quality and trustworthy.</p>
      </div>

      <Button type="button" onClick={onContinue}>
        Continue
      </Button>
    </div>
  );
}
