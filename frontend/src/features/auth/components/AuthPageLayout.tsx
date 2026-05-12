import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AuthHeroPanel } from "@/features/auth/components/AuthHeroPanel";

interface AuthPageLayoutProps {
  heading: string;
  description: string;
  children: ReactNode;
}

export function AuthPageLayout({ heading, description, children }: AuthPageLayoutProps) {
  const { t } = useTranslation();

  return (
    <main className="min-h-screen bg-background">
      <div className="min-h-screen flex">
        <section className="w-full lg:w-[52%] px-6 py-10 flex justify-center items-center">
          <div className="w-full max-w-[420px] space-y-6">
            <div className="space-y-2">
              <p className="text-[11px] tracking-wider uppercase text-muted-foreground">
                {t("auth.tagline")}
              </p>
              <h1 className="font-sans font-semibold text-[32px] text-foreground leading-tight">
                {heading}
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {description}
              </p>
            </div>

            {children}
          </div>
        </section>

        <AuthHeroPanel />
      </div>
    </main>
  );
}
