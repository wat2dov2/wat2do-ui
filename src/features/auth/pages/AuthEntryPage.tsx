import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { AuthHeroPanel } from "@/features/auth/components/AuthHeroPanel";
import { AuthEmailFormCard } from "@/features/auth/components/AuthEmailFormCard";
import { useAuthEntryFlow } from "@/features/auth/hooks/useAuthEntryFlow";

export function AuthEntryPage() {
  const navigate = useNavigate();

  const authEntry = useAuthEntryFlow({
    onContinueToOnboarding: () => {
      navigate("/onboarding");
    },
  });

  const handleContinueFromEmail = useCallback(() => {
    authEntry.onContinueFromEmail();
  }, [authEntry]);

  return (
    <main className="min-h-screen bg-background">
      <div className="min-h-screen flex">
        <section className="w-full lg:w-[52%] px-6 py-10 flex justify-center items-center">
          <div className="w-full max-w-[420px] space-y-6">
            <div className="space-y-2">
              <p className="text-[11px] tracking-wider uppercase text-muted-foreground">
                Campus events
              </p>
              <h1 className="font-sans font-bold text-[32px] text-foreground leading-tight">
                Discover what's happening on campus.
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Sign in or create your account to save events, personalize your feed,
                and get recommendations for your school.
              </p>
            </div>

            <AuthEmailFormCard
              email={authEntry.email}
              onEmailChange={authEntry.onEmailChange}
              onContinue={handleContinueFromEmail}
              canContinue={authEntry.isEmailValid}
            />
          </div>
        </section>

        <AuthHeroPanel />
      </div>
    </main>
  );
}
