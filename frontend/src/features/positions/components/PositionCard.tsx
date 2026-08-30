import { memo } from "react";
import { useTranslation } from "react-i18next";
import { PositionCardImage } from "@/features/positions/components/PositionCardImage";
import {
  createAdaptivePressHandlers,
  useMobileGridClickActivation,
} from "@/shared/hooks";
import {
  EventCardContent,
  EventCardContentFrame,
} from "@/shared/ui/event-card-content";
import type { Position } from "@/shared/types";

interface PositionCardProps {
  position: Position;
  onPositionClick: (position: Position) => void;
}

function PositionCardComponent({
  position,
  onPositionClick,
}: PositionCardProps) {
  const { t } = useTranslation();
  const preferClick = useMobileGridClickActivation();
  const pressHandlers = createAdaptivePressHandlers({
    onClick: () => onPositionClick(position),
    preferClick,
  });

  return (
    <article
      {...pressHandlers}
      role="button"
      tabIndex={0}
      aria-label={t("positions.openDetails", { title: position.title })}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPositionClick(position);
        }
      }}
      className="group flex h-full w-full cursor-pointer flex-col rounded-xl transition-all duration-300 hover:shadow-lg"
    >
      <PositionCardImage position={position} variant="card" />
      <EventCardContentFrame>
        <EventCardContent
          title={position.title}
          description={position.description}
        />
      </EventCardContentFrame>
    </article>
  );
}

export const PositionCard = memo(PositionCardComponent);
PositionCard.displayName = "PositionCard";
