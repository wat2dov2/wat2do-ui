import { useTranslation } from "react-i18next";
import NumberFlow from "@number-flow/react";

interface EventCountProps {
  count: number;
}

export function EventCount({ count }: EventCountProps) {
  const { t } = useTranslation();

  return (
    <span className="inline-flex items-baseline gap-2 text-2xl font-bold leading-none text-foreground sm:text-3xl">
      <NumberFlow value={count} respectMotionPreference={false} />
      <span>{count === 1 ? t("common.event") : t("common.events")}</span>
    </span>
  );
}
