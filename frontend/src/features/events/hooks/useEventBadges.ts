/**
 * Hook and pure function for generating event badges.
 * computeEventBadges is the single source of truth for badge logic.
 */

import { useTranslation } from "react-i18next";
import type { Event } from "@/shared/types";
import type { TFunction } from "i18next";
import { translateFood } from "@/shared/utils/foodTranslation";
import type { CardBadge } from "@/shared/ui/event-card-content";
import {
  Ticket,
  Utensils,
  X,
} from "@/shared/ui/doodle-icons";

interface BadgeInput {
  price?: number | null;
  food?: string[];
  registration?: boolean;
  cancelled?: boolean;
}

/**
 * Pure function: compute badges for an event-like object.
 * Free events do not get a price badge; only positive prices show `$N`.
 * Food uses the first listed item so cards stay concise even when an event
 * provides several foods.
 */
export function computeEventBadges(
  event: BadgeInput,
  t: TFunction,
): CardBadge[] {
  const badges: CardBadge[] = [];

  if (event.cancelled) {
    badges.push({
      text: t("common.cancelled"),
      size: "sm",
      icon: X,
    });
  }

  const price = event.price;
  if (price != null && price > 0) {
    badges.push({
      text: `$${price}`,
      size: "md",
    });
  }

  const food = event.food || [];
  if (food.length > 0) {
    badges.push({
      text: translateFood(food[0], t),
      size: "md",
      icon: Utensils,
    });
  }

  if (event.registration) {
    badges.push({
      text: t("common.registration"),
      size: "md",
      icon: Ticket,
    });
  }

  return badges;
}

/**
 * Hook to generate badges for an event (paid price, food).
 * Wraps computeEventBadges for React components.
 */
export function useEventBadges(event: Event): CardBadge[] {
  const { t } = useTranslation();
  return computeEventBadges(event, t);
}
