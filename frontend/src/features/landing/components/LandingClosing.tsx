"use client";

import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { EventPixelMosaic, LandingMosaicScrim } from "@/features/landing/components/EventPixelMosaic";
import { LandingCard, LandingNotchLabel } from "@/features/landing/components/LandingCard";
import { LandingHeading } from "@/features/landing/components/LandingSection";
import { ROUTES } from "@/shared/constants/routes";
import { Button } from "@/shared/ui/button";
import { ArrowRight, MapPin } from "lucide-react";

/** The last push back to the feed, restating the problem it ends, on a card cut like the hero's over the posters it has read. */
export function LandingClosing({ schoolName }: { schoolName: string }) {
  const { t } = useTranslation();

  return (
    <section>
      <LandingCard
        size="display"
        face={<EventPixelMosaic variant="ambient" />}
        corners={{
          "top-left": <LandingNotchLabel size="display" tone="school" icon={MapPin}>{schoolName}</LandingNotchLabel>,
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
        <div className="relative py-6 sm:py-12">
          <LandingMosaicScrim />
          <div className="relative">
            <LandingHeading
              align="center"
              title={t("landing.closing.title")}
              description={t("landing.closing.description", { school: schoolName })}
            />
          </div>
        </div>
      </LandingCard>
    </section>
  );
}
