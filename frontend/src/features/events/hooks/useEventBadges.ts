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
  cancelled?: boolean;
}

export interface BadgeStyleOverrides {
  cancelledBg?: string;
  cancelledText?: string;
  priceBg?: string;
  priceText?: string;
  foodBg?: string;
  foodText?: string;
}

/**
 * Pure function: compute badges for an event-like object.
 * Accepts optional style overrides for contexts that use different badge colors.
 * Free events do not get a price badge; only positive prices show `$N`.
 * Registration is not shown as a card badge.
 */
export function computeEventBadges(
  event: BadgeInput,
  t: TFunction,
  overrides?: BadgeStyleOverrides,
): EventBadge[] {
  const badges: EventBadge[] = [];

  if (event.cancelled) {
    badges.push({
      text: t("common.cancelled"),
      bgClass: overrides?.cancelledBg ?? "bg-destructive/15",
      textClass: overrides?.cancelledText ?? "text-destructive",
    });
  }

  const price = event.price;
  if (price != null && price > 0) {
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

  return badges;
}

/**
 * Hook to generate badges for an event (paid price, food).
 * Wraps computeEventBadges for React components.
 */
export function useEventBadges(event: Event): EventBadge[] {
  const { t } = useTranslation();
  return computeEventBadges(event, t);
}
