"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LandingPipelineDiagram } from "@/features/landing/components/LandingPipelineDiagram";
import { LandingRedacted } from "@/features/landing/components/LandingRedacted";
import { LandingSection } from "@/features/landing/components/LandingSection";
import { LANDING_ANCHORS } from "@/features/landing/lib/landingAnchors";
import { Stack } from "@/shared/layout";

// In the order a post travels: noticed, read, turned into an event, served.
const DIFFERENCES = ["relay", "alwaysOn", "claude", "cloud"] as const;

/** One line of the ledger: what a part of the machine does, and what it costs us. */
function LedgerRow({ title, description, cost }: { title: ReactNode; description: ReactNode; cost: ReactNode }) {
  return (
    <div className="grid gap-x-12 gap-y-3 border-t border-border py-8 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_8rem] sm:items-baseline">
      <h3 className="text-xl font-medium tracking-[-0.01em] text-foreground">{title}</h3>
      <p className="max-w-prose leading-relaxed text-pretty text-muted-foreground">{description}</p>
      <p className="text-lg tabular-nums text-foreground sm:text-right">{cost}</p>
    </div>
  );
}

/** Why the feed is complete when other event sites are not: the machine behind it, priced line by line. */
export function LandingDifferent() {
  const { t } = useTranslation();

  return (
    <LandingSection
      id={LANDING_ANCHORS.HOW_IT_WORKS}
      title={t("landing.different.title")}
      description={t("landing.different.description")}
    >
      <Stack gap={6}>
        <div className="border-b border-border">
          {DIFFERENCES.map((key) => {
            const cost = t(`landing.different.points.${key}.cost`);
            // The relay step is kept private: its line is drawn fully blurred and read out as "redacted".
            return key === "relay" ? (
              <div key={key} role="img" aria-label={t("landing.different.redacted")} className="pointer-events-none blur-[5px] select-none">
                <div aria-hidden="true">
                  <LedgerRow title={<LandingRedacted />} description={<LandingRedacted lines={4} />} cost={cost} />
                </div>
              </div>
            ) : (
              <LedgerRow
                key={key}
                title={t(`landing.different.points.${key}.title`)}
                description={t(`landing.different.points.${key}.description`)}
                cost={cost}
              />
            );
          })}
        </div>
        <p className="max-w-2xl text-pretty text-muted-foreground">{t("landing.different.costNote")}</p>
      </Stack>
      <div className="overflow-hidden rounded-3xl bg-surface-elevated p-4 sm:p-10">
        <LandingPipelineDiagram />
      </div>
    </LandingSection>
  );
}
