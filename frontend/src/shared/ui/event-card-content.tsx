/**
 * Shared visual shell for the content area below an event card image.
 * Used by EventCard, EventFormPreview, and PreviewStyleEventCard.
 */

import { Badge } from "@/shared/ui/badge";
import { Calendar, Clock, Instagram, MapPin, type LucideIcon } from "lucide-react";
import { Link } from "@/shared/ui/link";
import { SkeletonLine } from "@/shared/ui/skeleton";
import { TapTooltip } from "@/shared/ui/tooltip";
import { cn } from "@/shared/lib/utils";
import type { ComponentProps } from "react";

export interface CardBadge {
  /** Always set: the badge's text or, for an icon-only badge, its accessible name. */
  text: string;
  /** What the badge means, shown when it is tapped, clicked, hovered or focused. */
  tooltip?: string;
  size?: "sm" | "lg";
  icon?: LucideIcon;
  /** Cards show only the icon (and `mark`). */
  iconOnly?: boolean;
  /** A short sign drawn before the icon of an icon-only badge, such as "!" for required. */
  mark?: string;
}

const EMPTY_BADGES: readonly CardBadge[] = [];

/** A badge's icon steps up with the badge. */
const BADGE_ICON_SIZE_CLASS = { sm: "size-2.5", lg: "size-3.5" } as const;

/** Cards stack their badges beside the date, time and location, so a large badge is no taller than one of those lines. */
const CARD_BADGE_SIZE = { sm: "sm", lg: "stacked" } as const;

interface EventCardBadgeProps {
  badge: CardBadge;
  interactive: boolean;
  className: string;
}

/** One card badge. On a live card, a badge with a tooltip is a button: a tap explains it without opening the card. */
function EventCardBadge({ badge, interactive, className }: EventCardBadgeProps) {
  const Icon = badge.icon;
  const size = badge.size ?? "sm";
  const iconOnly = Boolean(badge.iconOnly && Icon);
  const badgeClassName = cn("max-w-full", iconOnly ? "gap-0.5" : "gap-1", className);
  const face = (
    <>
      {iconOnly && badge.mark ? (
        <span aria-hidden="true" className="font-bold leading-none">{badge.mark}</span>
      ) : null}
      {Icon ? <Icon aria-hidden="true" className={cn(BADGE_ICON_SIZE_CLASS[size], "shrink-0")} /> : null}
      {iconOnly ? null : <span className="min-w-0 truncate">{badge.text}</span>}
    </>
  );

  if (!interactive || !badge.tooltip) {
    return (
      <Badge
        variant="outline"
        size={CARD_BADGE_SIZE[size]}
        role={iconOnly ? "img" : undefined}
        aria-label={iconOnly ? badge.text : undefined}
        className={badgeClassName}
      >
        {face}
      </Badge>
    );
  }
  return (
    <TapTooltip content={badge.tooltip}>
      <Badge asChild variant="outline" size={CARD_BADGE_SIZE[size]} className={badgeClassName}>
        <button type="button" aria-label={iconOnly ? badge.text : undefined}>{face}</button>
      </Badge>
    </TapTooltip>
  );
}

/*
 * Typography and spacing shared by the card text and its loading placeholder,
 * so a placeholder line is always exactly the line box it stands in for.
 */
const CONTENT_CLASS = "relative flex flex-1 flex-col pb-2.5 pt-2 sm:pb-3 sm:pt-2.5";
const CONTENT_STACK_CLASS = "flex h-full flex-1 flex-col gap-2";
const TITLE_CLASS = "line-clamp-2 text-[15px] font-semibold leading-[1.1]";
const STATS_CLASS = "mt-0.5 block text-[11px] font-medium leading-none";
const DESCRIPTION_CLASS = "mt-2 line-clamp-2 text-xs leading-relaxed";
// The date, time and location follow the title at the stack's gap; a card stretched
// to its row's tallest neighbour keeps the spare height below them, not above.
const METADATA_CLASS = "flex min-w-0 items-end justify-between gap-1";
const METADATA_LINES_CLASS = "min-w-0 flex-1 space-y-0.5";
const METADATA_LINE_CLASS = "flex min-w-0 items-center gap-1 text-[13px]";
// Each badge sits in a slot one metadata line tall, at the lines' own gap, so a
// badge is centred on the date, time or location line beside it.
const BADGE_SLOT_CLASS = "flex h-[1lh] min-w-0 max-w-full items-center justify-end text-[13px]";

interface EventCardMetadataLineProps {
  icon: LucideIcon;
  slot: "date" | "time" | "location" | "instagram";
  text: string;
  textClassName: string;
}

function EventCardMetadataLine({
  icon: Icon,
  slot,
  text,
  textClassName,
}: EventCardMetadataLineProps) {
  return (
    <span
      data-slot={`event-card-${slot}`}
      className={cn(METADATA_LINE_CLASS, textClassName)}
    >
      <Icon aria-hidden="true" className="size-3 shrink-0" />
      <span className="truncate">{text}</span>
    </span>
  );
}

/**
 * Shared lower frame for image-led event and position cards.
 *
 * The page itself owns the surface, so the frame intentionally has no fill,
 * border, or shadow. Keeping that decision here prevents card call sites from
 * drifting back to separate visual shells.
 */
export function EventCardContentFrame({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="event-card-content-frame"
      className={cn(
        "relative z-20 flex flex-1 flex-col overflow-hidden rounded-b-xl rounded-tl-xl text-foreground",
        className,
      )}
      {...props}
    />
  );
}

interface EventCardContentProps {
  title: string;
  titleHref?: string;
  description?: string;
  date?: string;
  time?: string;
  location?: string;
  instagram?: string;
  badges?: readonly CardBadge[];
  /**
   * Badges say what they mean when tapped, hovered or focused. A preview card
   * stays inert: it shows the card an event will appear as, and nothing more.
   */
  interactive?: boolean;
  /** Popularity line, e.g. "12 clicks · 3 going". */
  statsLabel?: string;
  /**
   * Hold two title lines even for a one-line title, so a card is exactly as tall
   * as its loading placeholder, which draws two.
   */
  reserveTitleLines?: boolean;
  /**
   * Keep the popularity line's height while its stats load or when there are
   * none, so cards in a live grid never grow when the stats arrive.
   */
  reserveStatsLine?: boolean;
  className?: string;
  textClassName?: string;
  secondaryTextClassName?: string;
  badgeClassName?: string;
  horizontalPadding?: "flush" | "inset";
}

export function EventCardContent({
  title,
  titleHref,
  description,
  date,
  time,
  location,
  instagram,
  badges = EMPTY_BADGES,
  interactive = true,
  statsLabel,
  reserveTitleLines = false,
  reserveStatsLine = false,
  className,
  textClassName = "text-foreground",
  secondaryTextClassName = "text-muted-foreground",
  badgeClassName = "border-muted-foreground text-muted-foreground",
  horizontalPadding = "flush",
}: EventCardContentProps) {
  return (
    <div
      data-slot="event-card-content"
      className={cn(
        CONTENT_CLASS,
        horizontalPadding === "inset" && "px-2.5 sm:px-3",
        className,
      )}
    >
      <div className={CONTENT_STACK_CLASS}>
        <div className="min-w-0" data-skeleton-key="card-title">
          <h3 className={cn(TITLE_CLASS, reserveTitleLines && "min-h-[2lh]", textClassName)}>
            {titleHref ? (
              <Link variant="navigation" href={titleHref} prefetch={false}>
                {title}
              </Link>
            ) : (
              title
            )}
          </h3>
          {statsLabel || reserveStatsLine ? (
            <span
              aria-hidden={statsLabel ? undefined : true}
              className={cn(STATS_CLASS, badgeClassName)}
            >
              {statsLabel || "\u00a0"}
            </span>
          ) : null}
          {description ? (
            <p className={cn(DESCRIPTION_CLASS, secondaryTextClassName)}>
              {description}
            </p>
          ) : null}
        </div>

        {date || time || location || instagram || badges.length > 0 ? (
          <div
            data-slot="event-card-metadata"
            data-skeleton-key="card-meta"
            className={METADATA_CLASS}
          >
            <div className={METADATA_LINES_CLASS}>
              {date ? (
                <EventCardMetadataLine
                  icon={Calendar}
                  slot="date"
                  text={date}
                  textClassName={secondaryTextClassName}
                />
              ) : null}
              {time ? (
                <EventCardMetadataLine
                  icon={Clock}
                  slot="time"
                  text={time}
                  textClassName={secondaryTextClassName}
                />
              ) : null}
              {instagram ? (
                <EventCardMetadataLine
                  icon={Instagram}
                  slot="instagram"
                  text={instagram}
                  textClassName={secondaryTextClassName}
                />
              ) : null}
              {location ? (
                <EventCardMetadataLine
                  icon={MapPin}
                  slot="location"
                  text={location}
                  textClassName={secondaryTextClassName}
                />
              ) : null}
            </div>

            {badges.length > 0 && (
              /*
               * Capped rather than `shrink-0`: a food badge carries whatever the
               * host typed, so an unbounded one ("Free pizza, samosas and bubble
               * tea") ate the row and squeezed the date, time and location
               * beside it down to a few characters each. Two-fifths of the row is the
               * most this column may claim; past that the label ellipsises.
               * The badges stack on the same line pitch as the date, time and location,
               * bottom-aligned with them, so three badges line up with those three lines:
               * a card is as tall with three badges as with none, and its loading
               * skeleton matches either way.
               */
              <div
                data-slot="event-card-badges"
                className="flex min-w-0 max-w-[40%] shrink flex-col items-end space-y-0.5"
              >
                {badges.map((badge) => (
                  <span key={badge.text} className={BADGE_SLOT_CLASS}>
                    <EventCardBadge badge={badge} interactive={interactive} className={badgeClassName} />
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const TITLE_WIDTHS = ["w-full", "w-2/3"];
const DESCRIPTION_WIDTHS = ["w-full", "w-4/5"];
const METADATA_WIDTHS = ["w-1/2", "w-2/5", "w-3/5"];

interface EventCardContentSkeletonProps {
  titleLines?: 1 | 2;
  descriptionLines?: 0 | 2;
  /** Date, time and location lines; position cards have none. */
  metadataLines?: 0 | 3;
}

/** The card text's loading face: the same boxes as EventCardContent, line for line. */
export function EventCardContentSkeleton({
  titleLines = 2,
  descriptionLines = 0,
  metadataLines = 3,
}: EventCardContentSkeletonProps) {
  return (
    <div data-slot="event-card-content" aria-hidden="true" className={CONTENT_CLASS}>
      <div className={CONTENT_STACK_CLASS}>
        <div className="min-w-0" data-skeleton-key="card-title">
          <div className={TITLE_CLASS}>
            {TITLE_WIDTHS.slice(0, titleLines).map((width) => <SkeletonLine key={width} className={width} />)}
          </div>
          <span className={STATS_CLASS}><SkeletonLine className="w-1/3" /></span>
          {descriptionLines > 0 ? (
            <div className={DESCRIPTION_CLASS}>
              {DESCRIPTION_WIDTHS.map((width) => <SkeletonLine key={width} className={width} />)}
            </div>
          ) : null}
        </div>
        {metadataLines > 0 ? (
          <div data-skeleton-key="card-meta" className={METADATA_CLASS}>
            <div className={METADATA_LINES_CLASS}>
              {METADATA_WIDTHS.map((width) => (
                <span key={width} className={METADATA_LINE_CLASS}><SkeletonLine className={width} /></span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
