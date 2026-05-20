/**
 * Hook and pure function for generating event badges.
 * computeEventBadges is the single source of truth for badge logic.
 */

import { useTranslation } from "react-i18next";
import type { Event } from "@/shared/types";
import type { TFunction } from "i18next";

export interface EventBadge {
  text: string;
  bgClass: string;
  textClass: string;
}

export interface BadgeInput {
  price?: number | null;
  food?: string[];
  requiresRegistration?: boolean;
  registration?: boolean;
}

export interface BadgeStyleOverrides {
  freeBg?: string;
  freeText?: string;
  priceBg?: string;
  priceText?: string;
  foodBg?: string;
  foodText?: string;
  registrationBg?: string;
  registrationText?: string;
  registrationLabel?: string;
}

/**
 * Pure function: compute badges for an event-like object.
 * Accepts optional style overrides for contexts that use different badge colors.
 */
export function computeEventBadges(
  event: BadgeInput,
  t: TFunction,
  overrides?: BadgeStyleOverrides,
): EventBadge[] {
  const badges: EventBadge[] = [];

  const price = event.price ?? 0;
  if (price === 0) {
    badges.push({
      text: t("common.free"),
      bgClass: overrides?.freeBg ?? "bg-secondary",
      textClass: overrides?.freeText ?? "text-primary",
    });
  } else if (price !== null) {
    badges.push({
      text: `$${price}`,
      bgClass: overrides?.priceBg ?? "bg-primary/20",
      textClass: overrides?.priceText ?? "text-primary",
    });
  }

  const food = event.food || [];
  if (food.length > 0) {
    badges.push({
      text: t("common.freeFood"),
      bgClass: overrides?.foodBg ?? "bg-secondary",
      textClass: overrides?.foodText ?? "text-primary",
    });
  }

  const requiresRegistration = event.requiresRegistration ?? event.registration ?? false;
  if (requiresRegistration) {
    badges.push({
      text: overrides?.registrationLabel ?? t("common.registrationRequired"),
      bgClass: overrides?.registrationBg ?? "bg-purple-500/20",
      textClass: overrides?.registrationText ?? "text-purple-500",
    });
  }

  return badges;
}

/**
 * Hook to generate badges for an event (price, food, registration).
 * Wraps computeEventBadges with useMemo for React components.
 */
export function useEventBadges(event: Event): EventBadge[] {
  const { t } = useTranslation();
  return computeEventBadges(event, t);
}
