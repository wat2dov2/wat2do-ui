"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  LandingCard,
  LandingCardCopy,
  LandingCardGrid,
  LandingNotchLabel,
} from "@/features/landing/components/LandingCard";
import { LandingPipelineDiagram } from "@/features/landing/components/LandingPipelineDiagram";
import { LandingRedacted } from "@/features/landing/components/LandingRedacted";
import { LandingSection } from "@/features/landing/components/LandingSection";
import { LANDING_ANCHORS } from "@/features/landing/lib/landingAnchors";
import { Stack } from "@/shared/layout";

// In the order a post travels: noticed, read, turned into an event, served.
const DIFFERENCES = ["relay", "alwaysOn", "claude", "cloud"] as const;

/** One part of the machine: what it does, with what it costs us notched into the corner like a price tag. */
function LedgerCard({ cost, children }: { cost: ReactNode; children: ReactNode }) {
  return (
    <LandingCard corners={{ "top-right": <LandingNotchLabel>{cost}</LandingNotchLabel> }}>
      {children}
    </LandingCard>
  );
}

/** Why the feed is complete when other event sites are not: the machine behind it, priced part by part. */
export function LandingDifferent() {
  const { t } = useTranslation();

  return (
    <LandingSection
      id={LANDING_ANCHORS.HOW_IT_WORKS}
      title={t("landing.different.title")}
      description={t("landing.different.description")}
    >
      <Stack gap={6}>
        <LandingCardGrid columns={2}>
          {DIFFERENCES.map((key) => {
            const cost = t(`landing.different.points.${key}.cost`);
            // The relay step is kept private: its words are drawn fully blurred and read out as "redacted", only its cost shows.
            return key === "relay" ? (
              <LedgerCard key={key} cost={cost}>
                <div role="img" aria-label={t("landing.different.redacted")} className="pointer-events-none blur-[5px] select-none">
                  <div aria-hidden="true">
                    <LandingCardCopy title={<LandingRedacted />} description={<LandingRedacted lines={4} />} />
                  </div>
                </div>
              </LedgerCard>
            ) : (
              <LedgerCard key={key} cost={cost}>
                <LandingCardCopy
                  title={t(`landing.different.points.${key}.title`)}
                  description={t(`landing.different.points.${key}.description`)}
                />
              </LedgerCard>
            );
          })}
        </LandingCardGrid>
        <p className="max-w-2xl text-pretty text-muted-foreground">{t("landing.different.costNote")}</p>
      </Stack>
      <LandingCard>
        <LandingPipelineDiagram />
      </LandingCard>
    </LandingSection>
  );
}
