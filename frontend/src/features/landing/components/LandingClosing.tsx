"use client";

import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { LandingCard, LandingNotchLabel } from "@/features/landing/components/LandingCard";
import { LandingHeading } from "@/features/landing/components/LandingSection";
import { ROUTES } from "@/shared/constants/routes";
import { Button } from "@/shared/ui/button";
import { ArrowRight, MapPin } from "lucide-react";

/** The last push back to the feed, restating the problem it ends, on a card cut like the hero's. */
export function LandingClosing({ schoolName }: { schoolName: string }) {
  const { t } = useTranslation();

  return (
    <section>
      <LandingCard
        size="display"
        corners={{
          "top-left": <LandingNotchLabel size="display" icon={MapPin}>{schoolName}</LandingNotchLabel>,
          "bottom-right": (
            <Button size="lg" asChild>
              <NextLink href={ROUTES.EVENTS}>
                {t("landing.closing.action")}
                <ArrowRight aria-hidden="true" />
              </NextLink>
            </Button>
          ),
        }}
      >
        <LandingHeading
          align="center"
          title={t("landing.closing.title")}
          description={t("landing.closing.description", { school: schoolName })}
        />
      </LandingCard>
    </section>
  );
}
