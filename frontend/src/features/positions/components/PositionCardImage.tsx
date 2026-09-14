import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ImageOff } from "@/shared/ui/doodle-icons";
import { Badge } from "@/shared/ui/badge";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { ClubBadgeDropdown } from "@/features/clubs/components/ClubBadgeDropdown";
import {
  EventImageCutout,
  useEventImageCutouts,
} from "@/shared/ui/event-image-cutout";
import { EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";
import { formatPositionDeadlineBadge } from "@/features/positions/lib/positionDates";
import type { Position } from "@/shared/types";

interface PositionCardImageProps {
  position: Position;
  variant: "card" | "detail";
  onClubFilterSelect?: () => void;
}

export function PositionCardImage({
  position,
  variant,
  onClubFilterSelect,
}: PositionCardImageProps) {
  const { t, i18n } = useTranslation();
  const { surfaceRef, registerCorner, cutouts, box } = useEventImageCutouts();
  const deadlineDate = useMemo(
    () => formatPositionDeadlineBadge(position, i18n.language),
    [i18n.language, position],
  );
  return (
    <div
      ref={surfaceRef}
      data-slot="position-card-image"
      data-variant={variant}
      className={
        variant === "card"
          ? "relative shrink-0 overflow-hidden rounded-t-xl rounded-br-xl"
          : "relative aspect-square w-full overflow-hidden rounded-xl"
      }
      style={
        variant === "card" ? { height: EVENT_CARD_IMAGE_HEIGHT } : undefined
      }
    >
      <EventImageCutout
        backgroundColor="var(--surface-elevated)"
        imageSrc={position.source_image_url}
        imageAlt={position.title}
        imageLoading={variant === "card" ? "lazy" : "eager"}
        cutouts={cutouts}
        width={box.width}
        height={box.height}
        className="absolute inset-0"
      >
        {!position.source_image_url ? (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <ImageOff className="size-8 opacity-40" />
          </div>
        ) : null}
      </EventImageCutout>

      {variant === "detail" ? (
        <BadgeMask
          variant="top-left"
          cutout
          containerRef={registerCorner("top-left")}
        >
          <Badge variant="category" size="md">
            {t(`positions.types.${position.position_type}`)}
          </Badge>
        </BadgeMask>
      ) : null}

      {deadlineDate ? (
        <BadgeMask
          variant="top-right"
          cutout
          containerRef={registerCorner("top-right")}
        >
          <Badge variant="soon" size="md">
            {t("positions.due", { date: deadlineDate })}
          </Badge>
        </BadgeMask>
      ) : null}

      <BadgeMask
        variant="bottom-left"
        cutout
        containerRef={registerCorner("bottom-left")}
      >
        <ClubBadgeDropdown
          clubName={position.club_name}
          clubLogoUrl={position.club_logo_url}
          clubType={position.club_type}
          school={position.school}
          clubPage={position.club_page}
          clubIg={position.club_ig}
          clubDiscord={position.club_discord}
          onFilterSelect={onClubFilterSelect}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        />
      </BadgeMask>
    </div>
  );
}
