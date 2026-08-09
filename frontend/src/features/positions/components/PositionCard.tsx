import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PositionCardImage } from "@/features/positions/components/PositionCardImage";
import {
  createAdaptivePressHandlers,
  useMobileGridClickActivation,
} from "@/shared/hooks";
import { EventCardContent } from "@/shared/ui/event-card-content";
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
  const [isHoveringBadge, setIsHoveringBadge] = useState(false);
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
      className={`group flex h-full w-full cursor-pointer flex-col rounded-xl transition-all duration-300 ${
        isHoveringBadge ? "" : "hover:opacity-90 hover:shadow-lg"
      }`}
    >
      <PositionCardImage
        position={position}
        variant="card"
        onBadgeHoverChange={setIsHoveringBadge}
      />
      <div className="relative z-20 flex flex-1 flex-col overflow-hidden rounded-b-xl rounded-tl-xl border-x border-b border-border bg-surface text-foreground">
        <EventCardContent
          title={position.title}
          description={position.description}
        />
      </div>
    </article>
  );
}

export const PositionCard = memo(PositionCardComponent);
PositionCard.displayName = "PositionCard";
