"use client";

import { Trans, useTranslation } from "react-i18next";
import { LandingMark } from "@/features/landing/components/LandingMarks";
import { LandingPipelineDiagram } from "@/features/landing/components/LandingPipelineDiagram";
import { LandingRedacted } from "@/features/landing/components/LandingRedacted";
import { LandingCard, LandingIcon, LandingSection } from "@/features/landing/components/LandingSection";
import { LANDING_ANCHORS } from "@/features/landing/lib/landingAnchors";
import { Stack } from "@/shared/layout";
import { Badge } from "@/shared/ui/badge";
import { Clock, Shield, Sparkles, Zap, type LucideIcon } from "@/shared/ui/doodle-icons";

const DIFFERENCES: readonly { key: string; icon: LucideIcon }[] = [
  // In the order a post travels: noticed, read, turned into an event, served.
  { key: "relay", icon: Zap },
  { key: "alwaysOn", icon: Clock },
  { key: "claude", icon: Sparkles },
  { key: "cloud", icon: Shield },
];

/** Why the feed is complete when other event sites are not: the machine behind it. */
export function LandingDifferent() {
  const { t } = useTranslation();

  return (
    <LandingSection
      id={LANDING_ANCHORS.HOW_IT_WORKS}
      eyebrow={t("landing.different.eyebrow")}
      title={<Trans i18nKey="landing.different.title" components={{ mark: <LandingMark kind="underline" tone="pink" /> }} />}
      description={t("landing.different.description")}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {DIFFERENCES.map(({ key, icon }) => {
          const card = (
          <LandingCard
            header={
              // Each part of the machine carries what it costs us, as a price tag.
              <Stack direction="horizontal" justify="between" align="center" gap={2} wrap>
                <LandingIcon icon={icon} />
                <Badge variant="outline" size="lg">{t(`landing.different.points.${key}.cost`)}</Badge>
              </Stack>
            }
            // The relay step is kept private: its card is drawn fully blurred, with no copy behind it.
            title={key === "relay" ? <LandingRedacted /> : t(`landing.different.points.${key}.title`)}
            description={key === "relay" ? <LandingRedacted lines={4} /> : t(`landing.different.points.${key}.description`)}
          />
          );
          // The relay step is kept private: the whole card is blurred and read out as "redacted".
          return key === "relay" ? (
            <div key={key} role="img" aria-label={t("landing.different.redacted")} className="pointer-events-none h-full blur-[5px] select-none">
              <div aria-hidden="true" className="h-full">{card}</div>
            </div>
          ) : <div key={key} className="h-full">{card}</div>;
        })}
      </div>
      {/* Pulled up under the cards it sums up, closer than the band's usual rhythm. */}
      <p className="mx-auto -mt-6 max-w-2xl text-center text-pretty text-muted-foreground">{t("landing.different.costNote")}</p>
      <div className="overflow-hidden rounded-xl border border-border bg-surface p-4 sm:p-8">
        <LandingPipelineDiagram />
      </div>
    </LandingSection>
  );
}
