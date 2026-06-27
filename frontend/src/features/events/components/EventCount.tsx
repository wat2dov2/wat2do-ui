import { useTranslation } from "react-i18next";
import NumberFlow from "@number-flow/react";

interface EventCountProps {
  count: number;
}

export function EventCount({ count }: EventCountProps) {
  const { t } = useTranslation();

  return (
    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="inline-flex items-baseline gap-2 text-2xl font-bold leading-none text-foreground sm:text-3xl">
        <NumberFlow value={count} respectMotionPreference={false} />
        <span>{t("events.upcomingEventCount", { count })}</span>
      </span>
      <span className="text-xs font-medium text-muted-foreground sm:text-sm">
        {t("events.lastAddedSummary", { count: 1, time: "2h" })}
      </span>
    </span>
  );
}
