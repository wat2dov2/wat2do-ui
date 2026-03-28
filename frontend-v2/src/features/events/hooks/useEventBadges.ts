/**
 * Hook for generating event badges
 * Extracts badge logic from EventCard component
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Event } from "@/shared/types";

export interface EventBadge {
  text: string;
  bgClass: string;
  textClass: string;
}

/**
 * Hook to generate badges for an event (price, food, registration)
 */
export function useEventBadges(event: Event): EventBadge[] {
  const { t } = useTranslation();

  return useMemo(() => {
    const badges: EventBadge[] = [];

    // Price badge - grey bg, primary text
    const price = event.price ?? 0;
    if (price === 0) {
      badges.push({
        text: t("common.free"),
        bgClass: "bg-muted",
        textClass: "text-primary",
      });
    } else if (price !== null) {
      badges.push({
        text: `$${price}`,
        bgClass: "bg-primary/20",
        textClass: "text-primary",
      });
    }

    // Food badge - grey bg, primary text
    const food = event.food || [];
    if (food.length > 0) {
      badges.push({
        text: t("common.freeFood"),
        bgClass: "bg-muted",
        textClass: "text-primary",
      });
    }

    // Registration badge
    const requiresRegistration = event.requiresRegistration ?? event.registration ?? false;
    if (requiresRegistration) {
      badges.push({
        text: t("common.registrationRequired"),
        bgClass: "bg-purple-500/20",
        textClass: "text-purple-500",
      });
    }

    return badges;
  }, [event.price, event.food, event.requiresRegistration, event.registration, t]);
}
