import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ShieldAlert, CheckCircle, MailOpen, ArrowRight, UserCheck } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { Card, CardTitle, CardDescription, CardContent } from "@/shared/ui/card";
import { Spinner } from "@/shared/ui/spinner";
import { ROUTES } from "@/shared/constants/routes";
import { useAuthState } from "@/features/auth";
import { getInvitationByToken, acceptInvitationByToken, type OrganizationInvitationPublic } from "@/features/organization-panel/api/members.api";
import confetti from "canvas-confetti";
import { useTranslation } from "react-i18next";

export function InviteLandingPage() {
  const params = useParams<{ token?: string | string[] }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const router = useRouter();
  const { isAuthenticated, userEmail } = useAuthState();
  const { t } = useTranslation();


  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<OrganizationInvitationPublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("No invitation token provided.");
      setLoading(false);
      return;
    }

    async function loadInvite() {
      try {
        const data = await getInvitationByToken(token!);
        setInviteInfo(data);
      } catch (err) {
        console.error("Failed to load invitation:", err);
        setError("This invitation is invalid, has expired, or was already accepted.");
      } finally {
        setLoading(false);
      }
    }

    void loadInvite();
  }, [token]);

  const handleAccept = async () => {
    if (!token || accepting) return;
    setAccepting(true);
    setError(null);

    try {
      await acceptInvitationByToken(token);
      setSuccess(true);

      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 }
      });

      setTimeout(() => {
        router.push(ROUTES.ORGANIZATION_PANEL);
      }, 2000);
    } catch (err) {
      console.error("Failed to accept invitation:", err);
      setError("Failed to accept invitation. Please try again.");
      setAccepting(false);
    }
  };

  const handleAuthRedirect = (mode: "signup" | "login") => {
    if (!inviteInfo) return;
    const searchParams = new URLSearchParams({
      token: token || "",
      email: inviteInfo.email,
      mode: mode,
    });
    router.push(`${ROUTES.LOGIN}?${searchParams.toString()}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-radial-gradient from-secondary/30 via-background to-background px-4">
        <div className="text-center space-y-4">
          <Spinner className="size-10 text-primary mx-auto" />
          <p className="text-muted-foreground animate-pulse font-medium">{t("inviteLanding.validating")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/4 size-72 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 size-96 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />

      <Card className="max-w-md w-full border border-border/80 bg-surface/60 backdrop-blur-md shadow-2xl relative z-10 overflow-hidden">
        <div className="h-1.5 w-full bg-gradient-to-r from-primary via-blue-500 to-indigo-600" />

        <CardContent className="pt-8 px-6 pb-6 text-center space-y-6">
          {error ? (
            <div className="space-y-4 animate-in fade-in zoom-in duration-200">
              <div className="size-16 rounded-full bg-destructive/10 border border-destructive/20 flex items-center justify-center mx-auto text-destructive">
                <ShieldAlert className="size-8" />
              </div>
              <CardTitle className="text-xl font-bold tracking-tight text-foreground">{t("inviteLanding.errorTitle")}</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                {error}
              </CardDescription>
              <Button onMouseDown={() => router.push(ROUTES.HOME)} className="w-full mt-2">
                {t("inviteLanding.goHome")}
              </Button>
            </div>
          ) : success ? (
            <div className="space-y-4 animate-in fade-in zoom-in duration-200">
              <div className="size-16 rounded-full bg-success/10 border border-success/20 flex items-center justify-center mx-auto text-success">
                <CheckCircle className="size-8" />
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight text-foreground">{t("inviteLanding.successTitle")}</CardTitle>
              <p className="text-muted-foreground text-sm">
                {t("inviteLanding.successMessagePrefix")} <strong>{inviteInfo?.organization_name}</strong>.
              </p>
              <p className="text-xs text-primary animate-pulse font-medium pt-2">
                {t("inviteLanding.redirecting")}
              </p>
            </div>
          ) : (
            <div className="space-y-5 animate-in fade-in zoom-in duration-200">
              <div className="size-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto text-primary">
                <MailOpen className="size-8" />
              </div>

              <div className="space-y-2">
                <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
                  {t("inviteLanding.manageTitle", { organizationName: inviteInfo?.organization_name })}
                </CardTitle>
                <CardDescription className="text-sm">
                  {t("inviteLanding.description")}
                </CardDescription>
              </div>

              <div className="p-3 bg-secondary/40 border border-border rounded-xl">
                <p className="text-xs text-muted-foreground font-medium mb-1">{t("inviteLanding.emailBadgeLabel")}</p>
                <p className="text-sm font-semibold text-foreground break-all">{inviteInfo?.email}</p>
              </div>

              {isAuthenticated && userEmail && inviteInfo && userEmail.toLowerCase() !== inviteInfo.email.toLowerCase() && (
                <div className="p-3 bg-warning/10 border border-warning/20 rounded-xl text-left flex gap-3 text-warning">
                  <ShieldAlert className="size-5 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-xs font-semibold">{t("inviteLanding.mismatchTitle")}</p>
                    <p className="text-[11px] leading-relaxed opacity-90">
                      {t("inviteLanding.mismatchMessage", { invitedEmail: inviteInfo.email, currentEmail: userEmail })}
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-3 pt-2">
                {isAuthenticated ? (
                  <Button onMouseDown={handleAccept} className="w-full h-11 text-sm font-medium" disabled={accepting}>
                    {accepting ? (
                      <>
                        <Spinner className="size-4 mr-2" />
                        {t("inviteLanding.joining")}
                      </>
                    ) : (
                      <>
                        <UserCheck className="size-4 mr-2" />
                        {t("inviteLanding.acceptButton")}
                      </>
                    )}
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <Button onMouseDown={() => handleAuthRedirect("signup")} className="w-full h-11 text-sm font-medium group">
                      {t("inviteLanding.signUpButton")}
                      <ArrowRight className="size-4 ml-2 transition-transform group-hover:translate-x-1" />
                    </Button>
                    <div className="text-xs text-muted-foreground text-center">
                      {t("inviteLanding.alreadyHaveAccount")}{" "}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onMouseDown={() => handleAuthRedirect("login")}
                      >
                        {t("inviteLanding.logIn")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
