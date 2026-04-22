import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();

  return (
    <div className="w-full max-w-[480px] space-y-6">
      <div className="space-y-2">
        <p className="text-[11px] tracking-wider uppercase text-muted-foreground">
          {t("auth.tagline")}
        </p>
        <h2 className="font-sans font-bold text-[28px] leading-tight text-foreground">
          {t("auth.consentHeading")}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("auth.consentDescription")}
        </p>
      </div>

      <ul className="space-y-2 text-sm text-muted-foreground leading-relaxed">
        <li>{t("auth.consentControlData")}</li>
        <li>{t("auth.consentNoSell")}</li>
        <li>{t("auth.consentAnonymized")}</li>
      </ul>

      <div className="rounded-xl border border-border bg-secondary/30 p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="agree-terms" className="text-sm text-foreground font-normal leading-snug flex-1 cursor-pointer">
            {t("auth.consentAgreeTerms")}
          </Label>
          <Switch
            id="agree-terms"
            checked={agreedToTerms}
            onCheckedChange={onAgreedToTermsChange}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="subscribe-updates" className="text-sm text-foreground font-normal leading-snug flex-1 cursor-pointer">
            {t("auth.consentSubscribeUpdates")}
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
          {t("common.continue")}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground text-center">
        {t("auth.signedInAs")} <span className="font-medium text-foreground">{email}</span>
      </p>
    </div>
  );
}
