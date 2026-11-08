import type { ReactNode } from "react";
import Image from "next/image";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/shared/ui/card";
import { PageHeader, type PageHeaderBack } from "@/shared/layout";
import { ShineBorder } from "@/registry/magicui/shine-border";

interface AuthCardProps {
  heading: string;
  description: string;
  back?: PageHeaderBack;
  children?: ReactNode;
}

/**
 * The sign-in card: the login page shows it beside its preview, and the
 * sign-in dialog shows the same card over a page.
 */
export function AuthCard({ heading, description, back, children }: AuthCardProps) {
  const { t } = useTranslation();

  return (
    <Card className="relative w-full max-w-[440px] overflow-hidden gap-0">
      <ShineBorder shineColor="var(--primary)" />
      <CardContent className="space-y-6 p-8">
        {back ? <PageHeader back={back} /> : null}

        <Image
          alt={t("common.logo")}
          width={104}
          height={28}
          className="h-7 w-[104px] object-contain"
          src="/brand/wat2do-secondary.svg"
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
  );
}
