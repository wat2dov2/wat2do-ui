import { LoadingButton } from "@/shared/ui/loading-button";
import { Input } from "@/shared/ui/input";
import type { AuthMode } from "@/features/auth/hooks/useAuthEntryFlow";

interface AuthEmailFormCardProps {
  email: string;
  password: string;
  authMode: AuthMode;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onContinue: () => void;
  onToggleMode: () => void;
  canContinue: boolean;
  isLoading: boolean;
  error: string | null;
}

export function AuthEmailFormCard({
  email,
  password,
  authMode,
  onEmailChange,
  onPasswordChange,
  onContinue,
  onToggleMode,
  canContinue,
  isLoading,
  error,
}: AuthEmailFormCardProps) {
  const isSignup = authMode === "signup";

  return (
    <div className="w-full space-y-4">
      <Input
        type="email"
        value={email}
        onChange={(e) => onEmailChange(e.target.value)}
        placeholder="you@uwaterloo.ca"
        onKeyDown={(e) => e.key === "Enter" && canContinue && onContinue()}
      />

      <Input
        type="password"
        value={password}
        onChange={(e) => onPasswordChange(e.target.value)}
        placeholder={isSignup ? "Create a password (min 6 chars)" : "Password"}
        onKeyDown={(e) => e.key === "Enter" && canContinue && onContinue()}
      />

      {error && (
        <p className="text-sm text-destructive text-center">{error}</p>
      )}

      <LoadingButton
        type="button"
        onClick={onContinue}
        disabled={!canContinue}
        isLoading={isLoading}
        loadingText="Please wait..."
        className="w-full"
      >
        {isSignup ? "Create account" : "Sign in"}
      </LoadingButton>

      <p className="text-[11px] text-center text-muted-foreground">
        {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
        <button
          type="button"
          onClick={onToggleMode}
          className="underline underline-offset-2 hover:text-foreground transition-colors"
        >
          {isSignup ? "Sign in" : "Create one"}
        </button>
      </p>

      <p className="text-[11px] text-center text-muted-foreground">
        By continuing, you agree to the platform terms and event community guidelines.
      </p>
    </div>
  );
}
