import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

interface AuthEmailFormCardProps {
  email: string;
  onEmailChange: (value: string) => void;
  onContinue: () => void;
  canContinue: boolean;
}

export function AuthEmailFormCard({
  email,
  onEmailChange,
  onContinue,
  canContinue,
}: AuthEmailFormCardProps) {
  return (
    <div className="w-full space-y-4">
      <Input
        type="email"
        value={email}
        onChange={(event) => onEmailChange(event.target.value)}
        placeholder="you@uwaterloo.ca"
      />

      <Button
        type="button"
        onClick={onContinue}
        disabled={!canContinue}
        className="w-full"
      >
        Continue with school email
      </Button>

      <p className="text-[11px] text-center text-muted-foreground">
        Use your university email to sign in. By continuing, you agree to the platform terms and event community guidelines.
      </p>
    </div>
  );
}
