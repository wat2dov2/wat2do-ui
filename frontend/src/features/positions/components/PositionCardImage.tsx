import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/shared/ui/badge";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { ClubBadgeDropdown } from "@/features/clubs/components/ClubBadgeDropdown";
import {
  EventImageCutout,
  useEventImageCutouts,
} from "@/shared/ui/event-image-cutout";
import { EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";
import { formatPositionDeadlineBadge } from "@/features/positions/lib/positionDates";
import { wasAddedWithinLast24Hours } from "@/shared/utils/date";
import type { Position } from "@/shared/types";

interface PositionCardImageProps {
  position: Position;
  variant: "card" | "detail";
  onClubFilterSelect?: () => void;
  priority?: boolean;
}

export function PositionCardImage({
  position,
  variant,
  onClubFilterSelect,
  priority = false,
}: PositionCardImageProps) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const { surfaceRef, registerCorner, cutouts, box } = useEventImageCutouts();
  const deadlineDate = useMemo(
    () => formatPositionDeadlineBadge(position, i18n.language, getSchoolTimezone(position.school)),
    [i18n.language, position, getSchoolTimezone],
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
        imageLoading={variant === "detail" || priority ? "eager" : "lazy"}
        imageSizes={variant === "detail" ? "(max-width: 767px) calc(100vw - 48px), 480px" : undefined}
        cutouts={cutouts}
        width={box.width}
        height={box.height}
        className="absolute inset-0"
      />

      {variant === "card" && wasAddedWithinLast24Hours(position) ? (
        <BadgeMask variant="top-left" cutout containerRef={registerCorner("top-left")}>
          <Badge variant="new" size="md">{t("events.new")}</Badge>
        </BadgeMask>
      ) : null}

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
