import React from "react";
import { useTranslation } from "react-i18next";

interface EventCountProps {
  count: number;
}

export function EventCount({ count }: EventCountProps) {
  const { t } = useTranslation();

  return (
    <span className="font-bold text-xl text-foreground">
      {count} {count === 1 ? t("common.event") : t("common.events")}
    </span>
  );
}
