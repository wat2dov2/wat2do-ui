import type { ReactNode } from "react";
import Image from "next/image";
import { useTranslation } from "react-i18next";
import imgLogo from "@/assets/38e8096a28295e8dcc0e5020d0a5f3dd85d5f019.png";
import { AuthHeroPanel } from "@/features/auth/components/AuthHeroPanel";
import { Card, CardContent } from "@/shared/ui/card";
import { PageHeader, type PageHeaderBack } from "@/shared/layout";
import { ShineBorder } from "@/registry/magicui/shine-border";
import type { Event } from "@/shared/types";

interface AuthPageLayoutProps {
  heading: string;
  description: string;
  previewEvents?: Event[];
  back?: PageHeaderBack;
  children: ReactNode;
}

export function AuthPageLayout({
  heading,
  description,
  previewEvents = [],
  back,
  children,
}: AuthPageLayoutProps) {
  const { t } = useTranslation();

  return (
    <main className="min-h-screen">
      <div className="min-h-screen flex">
        <section className="w-full lg:w-[52%] px-6 py-10 flex justify-center items-center">
          <Card className="relative w-full max-w-[440px] overflow-hidden gap-0">
            <ShineBorder shineColor="var(--primary)" />
            <CardContent className="space-y-6 p-8">
              {back ? <PageHeader back={back} /> : null}

              <Image
                alt={t("common.logo")}
                width={40}
                height={28}
                className="h-7 w-[40px] object-contain"
                src={imgLogo}
              />

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

        <AuthHeroPanel events={previewEvents} />
      </div>
    </main>
  );
}
