import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { Label } from "@/shared/ui/label";

interface AuthConsentCardProps {
  email: string;
  agreedToTerms: boolean;
  subscribedToUpdates: boolean;
  onAgreedToTermsChange: (value: boolean) => void;
  onSubscribedToUpdatesChange: (value: boolean) => void;
  onContinue: () => void;
  canContinue: boolean;
}

export function AuthConsentCard({
  email,
  agreedToTerms,
  subscribedToUpdates,
  onAgreedToTermsChange,
  onSubscribedToUpdatesChange,
  onContinue,
  canContinue,
}: AuthConsentCardProps) {
  return (
    <div className="w-full max-w-[480px] space-y-6">
      <div className="space-y-2">
        <p className="text-[11px] tracking-wider uppercase text-muted-foreground">
          Campus events
        </p>
        <h2 className="font-sans font-bold text-[28px] leading-tight text-foreground">
          Data, safety, and your campus feed
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          How we keep event discovery safe and useful for students.
        </p>
      </div>

      <ul className="space-y-2 text-sm text-muted-foreground leading-relaxed">
        <li>You control your profile data and can update or delete your account anytime.</li>
        <li>We do not sell your data to third parties or data brokers.</li>
        <li>We may review anonymized usage patterns to improve event recommendations.</li>
      </ul>

      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="agree-terms" className="text-sm text-foreground font-normal leading-snug flex-1 cursor-pointer">
            I agree to the platform terms and acceptable use policy for campus event discovery.
          </Label>
          <Switch
            id="agree-terms"
            checked={agreedToTerms}
            onCheckedChange={onAgreedToTermsChange}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="subscribe-updates" className="text-sm text-foreground font-normal leading-snug flex-1 cursor-pointer">
            Subscribe to occasional updates about new features and campus event highlights.
          </Label>
          <Switch
            id="subscribe-updates"
            checked={subscribedToUpdates}
            onCheckedChange={onSubscribedToUpdatesChange}
          />
        </div>

        <Button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          className="w-full"
        >
          Continue
        </Button>
      </div>

      <p className="text-sm text-muted-foreground text-center">
        Signed in as <span className="font-medium text-foreground">{email}</span>
      </p>
    </div>
  );
}
