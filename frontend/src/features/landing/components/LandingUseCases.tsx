"use client";

import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { EMPTY_FILTER_STATE, freeFoodFilterPatch } from "@/features/search/api/filterService";
import { useSearchStore } from "@/features/search/store/search.store";
import { LandingRuledGrid, LandingRuledItem, LandingSection } from "@/features/landing/components/LandingSection";
import { ROUTES } from "@/shared/constants/routes";
import { Button } from "@/shared/ui/button";
import { ArrowRight } from "@/shared/ui/doodle-icons";
import type { FilterState } from "@/shared/types";

/**
 * Each use case opens the feed already narrowed to it, or the page that
 * serves it, so the card's promise is one click from being true.
 */
const USE_CASES: readonly { key: string; href: string; filters?: Partial<FilterState> }[] = [
  { key: "freeFood", href: ROUTES.EVENTS, filters: freeFoodFilterPatch(true) },
  { key: "employers", href: ROUTES.EVENTS, filters: { employersOnCampus: true } },
  { key: "competitions", href: ROUTES.EVENTS, filters: { competitions: true } },
  { key: "newToCampus", href: ROUTES.CLUBS },
  { key: "getInvolved", href: ROUTES.POSITIONS },
  { key: "bored", href: ROUTES.EVENTS, filters: { searchQuery: "random" } },
];

export function LandingUseCases({ schoolName }: { schoolName: string }) {
  const { t } = useTranslation();

  return (
    <LandingSection
      title={t("landing.useCases.title")}
      description={t("landing.useCases.description", { school: schoolName })}
    >
      <LandingRuledGrid columns={3}>
        {USE_CASES.map(({ key, href, filters }) => (
          <LandingRuledItem
            key={key}
            title={t(`landing.useCases.items.${key}.title`)}
            description={t(`landing.useCases.items.${key}.description`)}
            action={
              <Button variant="link" size="inline" asChild>
                <NextLink
                  href={href}
                  onClick={filters ? () => useSearchStore.getState().setFilterState({ ...EMPTY_FILTER_STATE, ...filters }) : undefined}
                >
                  {t(`landing.useCases.items.${key}.action`)}
                  <ArrowRight aria-hidden="true" />
                </NextLink>
              </Button>
            }
          />
        ))}
      </LandingRuledGrid>
    </LandingSection>
  );
}
