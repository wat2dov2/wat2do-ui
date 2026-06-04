import { useTranslation } from "react-i18next";
import NumberFlow from "@number-flow/react";

interface EventCountProps {
  count: number;
}

export function EventCount({ count }: EventCountProps) {
  const { t } = useTranslation();

  return (
    <span className="font-bold text-xl text-foreground inline-flex items-baseline gap-1">
      <NumberFlow value={count} respectMotionPreference={false} />
      <span>{count === 1 ? t("common.event") : t("common.events")}</span>
    </span>
  );
}
