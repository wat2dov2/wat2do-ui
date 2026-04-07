/**
 * Event card in the same style as the auth page right-side (hero) section.
 * Used in AuthHeroPanel and OnboardingEventGrid.
 */

import { useTranslation } from "react-i18next";
import { Users, ImageOff } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { getCategoryClasses, translateCategory } from "@/shared/utils/event";
import { LazyImage } from "@/shared/ui/lazy-image";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { LightRays } from "@/shared/ui/light-rays";
import { PREVIEW_CARD_IMAGE_HEIGHT } from "@/features/auth/constants";

export interface PreviewEventData {
  title: string;
  org: string;
  category: string;
  image: string;
  date: string;
  time: string;
  location: string;
  badges: Array<{ text: string; bgClass: string; textClass: string }>;
}

interface PreviewStyleEventCardProps {
  event: PreviewEventData;
  selected?: boolean;
  onClick?: () => void;
  /** Optional key for list (e.g. event id when used with real events) */
  "data-event-id"?: number;
}

export function PreviewStyleEventCard({
  event,
  selected = false,
  onClick,
  "data-event-id": dataEventId,
}: PreviewStyleEventCardProps) {
  const { t } = useTranslation();
  const catClasses = getCategoryClasses(event.category);

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      data-event-id={dataEventId}
      className={cn(
        "rounded-xl overflow-hidden flex flex-col bg-card",
        onClick && "cursor-pointer transition-shadow duration-200 hover:opacity-90",
        selected && "outline-2 outline-sky-400 dark:outline-sky-300 outline-offset-2 rounded-xl"
      )}
    >
      <div className="relative overflow-hidden" style={{ height: PREVIEW_CARD_IMAGE_HEIGHT }}>
        <LazyImage
          src={event.image}
          alt={event.title}
          className="absolute inset-0 w-full h-full"
          fallback={
            <div className="absolute inset-0 bg-linear-to-br from-muted to-muted/80 flex items-center justify-center">
              <ImageOff className="w-8 h-8 text-muted-foreground/40" />
            </div>
          }
          placeholder={
            <div className="absolute inset-0 bg-linear-to-br from-muted to-muted/80 animate-pulse" />
          }
        />

        <BadgeMask variant="top-left">
          <span
            className={cn(
              "font-bold text-[10px] px-2 py-0.5 block rounded-full",
              catClasses.bg,
              catClasses.text
            )}
          >
            {translateCategory(event.category, t)}
          </span>
        </BadgeMask>

        <BadgeMask variant="bottom-left">
          <span className="font-bold text-[10px] px-2 py-0.5 rounded-full bg-background border border-foreground text-foreground flex items-center gap-1.5">
            <Users className="w-3 h-3" strokeWidth={2} />
            <span className="truncate max-w-[80px]">{event.org}</span>
          </span>
        </BadgeMask>
      </div>

      <div className="relative flex flex-col flex-1 px-4 pt-4 pb-3 border-l border-r border-b border-border rounded-b-xl">
        <LightRays />
        <div className="flex items-start gap-3 h-full flex-1">
          <div className="flex-1 min-w-0 flex flex-col h-full gap-3">
            <h3 className="font-bold text-base leading-tight line-clamp-2 text-foreground">
              {event.title}
            </h3>
            <div className="space-y-0.5 mt-auto">
              <span className="text-[11px] text-muted-foreground block">{event.date}</span>
              <span className="text-[11px] text-muted-foreground block">{event.time}</span>
              <span className="text-[11px] text-muted-foreground block truncate">
                {event.location}
              </span>
            </div>
          </div>

          {event.badges.length > 0 && (
            <div className="flex flex-col gap-1.5 items-end shrink-0">
              {event.badges.map((badge) => (
                <span
                  key={badge.text}
                  className="font-medium text-[10px] px-2 py-0.5 rounded-xl border border-white text-white"
                >
                  {badge.text}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
