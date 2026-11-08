import { useTranslation } from "react-i18next";
import { AuthCard } from "@/features/auth/components/AuthCard";
import { EmailOtpForm } from "@/features/auth/components/EmailOtpForm";
import { GoogleSignInButton } from "@/features/auth/components/GoogleSignInButton";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";

interface SignInDialogProps {
  /** True once the visitor has signed in here, false when they close the dialog. */
  onSettled: (signedIn: boolean) => void;
}

/**
 * The login page's card over the page. A form asks for it only when it is
 * sent, and sends once the visitor has signed in, by email code or with
 * Google in a window of its own, so the form underneath keeps what they typed.
 */
export function SignInDialog({ onSettled }: SignInDialogProps) {
  const { t } = useTranslation();
  const signedIn = () => onSettled(true);

  return (
    <Dialog open onOpenChange={(open) => !open && onSettled(false)}>
      <DialogContent variant="card" size="md" aria-describedby={undefined}>
        <DialogTitle className="sr-only">{t("auth.heading")}</DialogTitle>
        <AuthCard heading={t("auth.heading")} description={t("auth.description")}>
          <GoogleSignInButton onSignedIn={signedIn} />
          <EmailOtpForm className="mt-4" onAuthenticated={signedIn} />
        </AuthCard>
      </DialogContent>
    </Dialog>
  );
}
