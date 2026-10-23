import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useRequestSchool } from "@/app/client-providers";
import { BrandLogo } from "@/shared/ui/brand-logo";
import { AuthHeroPanel } from "@/features/auth/components/AuthHeroPanel";
import { Card, CardContent } from "@/shared/ui/card";
import { PageHeader, type PageHeaderBack } from "@/shared/layout";
import { ShineBorder } from "@/registry/magicui/shine-border";

interface AuthPageLayoutProps {
  heading: string;
  description: string;
  preview?: ReactNode;
  back?: PageHeaderBack;
  children: ReactNode;
}

export function AuthPageLayout({
  heading,
  description,
  preview,
  back,
  children,
}: AuthPageLayoutProps) {
  const { t } = useTranslation();
  const requestSchool = useRequestSchool();

  return (
    <main className="min-h-screen">
      <div className="min-h-screen flex">
        <section className="w-full lg:w-[52%] px-6 py-10 flex justify-center items-center">
          <Card className="relative w-full max-w-[440px] overflow-hidden gap-0">
            <ShineBorder shineColor="var(--primary)" />
            <CardContent className="space-y-6 p-8">
              {back ? <PageHeader back={back} /> : null}

              <BrandLogo school={requestSchool} size="card" alt={t("common.logo")} />

              <div className="space-y-2">
                <h1 className="font-sans font-semibold text-[28px] text-foreground leading-tight text-balance">
                  {heading}
                </h1>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {description}
                </p>
              </div>

              {children}
            </CardContent>
          </Card>
        </section>

        {preview ?? <AuthHeroPanel />}
      </div>
    </main>
  );
}
