import { useTranslation } from "react-i18next";
import type { Event } from "@/shared/types";
import { computeEventBadges } from "@/shared/utils/event";

export function useEventBadges(event: Event) {
  const { t } = useTranslation();
  return computeEventBadges(event, t);
}
