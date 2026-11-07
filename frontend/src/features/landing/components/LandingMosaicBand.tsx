"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { ArrowRight, Clock, Sparkles } from "lucide-react";
import { EventPixelMosaic } from "@/features/landing/components/EventPixelMosaic";
import { LandingCard, LandingNotchLabel } from "@/features/landing/components/LandingCard";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import { loadMosaicManifest, type MosaicManifest } from "@/features/landing/lib/eventMosaicAtlas";
import type { MosaicCell, MosaicController } from "@/features/landing/lib/eventPixelMosaic";
import { formatLandingCount } from "@/features/landing/lib/landingStats";
import { ROUTES } from "@/shared/constants/routes";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Stack } from "@/shared/layout";
import { posterThumbnailUrl } from "@/shared/utils/media";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { LazyImage } from "@/shared/ui/lazy-image";
import { Popover, PopoverAnchor, PopoverContent } from "@/shared/ui/popover";
import { Skeleton } from "@/shared/ui/skeleton";

/** Hover intent before a poster opens, and grace to move the pointer into it before it closes. */
const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 180;

const ARROW_STEPS: Record<string, (columns: number) => number> = {
  ArrowLeft: () => -1,
  ArrowRight: () => 1,
  ArrowUp: (columns) => -columns,
  ArrowDown: (columns) => columns,
};

/** The poster behind a cell, large, with what its card would say and a way to it: its event page, or the positions page for a club position. */
function MosaicPosterDetails({ manifest, cell }: { manifest: MosaicManifest; cell: MosaicCell }) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const poster = manifest.posters[cell.poster];
  const timeZone = getSchoolTimezone(manifest.school);
  const isEvent = poster.kind === "event" && poster.start !== null;
  const occurrence = { occurrences: isEvent ? [{ dtstart_utc: poster.start!, dtend_utc: poster.end }] : [] };
  const when = isEvent
    ? [formatCardDate(occurrence, timeZone, i18n.language), formatCardTime(occurrence, timeZone, i18n.language)].filter(Boolean).join(t("common.separatorBullet"))
    : "";

  return (
    <Stack gap={3}>
      {/* 4px: the popover's 12px radius less its 8px padding, so the corners nest. */}
      <LazyImage src={posterThumbnailUrl(poster.image)} alt={poster.title} fit="cover" loading="eager" className="aspect-[4/5] w-full overflow-hidden rounded-[4px]" />
      <Stack gap={2} className="px-2 pb-2">
        <p className="line-clamp-2 font-semibold leading-tight text-balance text-foreground">{poster.title}</p>
        {poster.club ? <p className="truncate text-sm text-muted-foreground">{poster.club}</p> : null}
        <Stack direction="horizontal" gap={2} align="center" justify="between" wrap>
          {when ? (
            <Badge variant="tint-time" size="lg" className="gap-1.5 tabular-nums">
              <Clock aria-hidden="true" className="size-3.5 shrink-0" />
              {when}
            </Badge>
          ) : null}
          <Button variant="outline" size="sm" asChild>
            <NextLink href={isEvent ? eventPagePath(poster.id) : ROUTES.POSITIONS}>
              {t("common.view")}
              <ArrowRight aria-hidden="true" />
            </NextLink>
          </Button>
        </Stack>
      </Stack>
    </Stack>
  );
}

/**
 * A strip of the posters Wat2Do has read, at full colour, between the problem
 * and its fix. Hovering a poster, tapping it, or moving to it with the arrow
 * keys opens it large with its event; that poster holds still while open.
 */
export function LandingMosaicBand({ newThisWeekCount }: { newThisWeekCount: number | null }) {
  const { t, i18n } = useTranslation();
  const mosaic = useRef<{ controller: MosaicController; canvas: HTMLCanvasElement } | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const openedByKeyboard = useRef(false);
  const [manifest, setManifest] = useState<MosaicManifest | null>(null);
  /** The cell being pointed at or focused, with its box in this area's coordinates for the popover anchor. */
  const [target, setTarget] = useState<{ cell: MosaicCell; anchor: CSSProperties } | null>(null);
  const cell = target?.cell ?? null;
  const [open, setOpen] = useState(false);

  const label = newThisWeekCount === null
    ? null
    : `${formatLandingCount(newThisWeekCount, i18n.language)} ${t("landing.solution.stats.newLabel", { count: newThisWeekCount })}`;

  const onReady = useCallback((controller: MosaicController, canvas: HTMLCanvasElement) => {
    mosaic.current = { controller, canvas };
    void loadMosaicManifest().then(setManifest);
  }, []);

  // The open poster holds still; every other cell keeps swapping.
  useEffect(() => {
    mosaic.current?.controller.pin(open && cell ? cell.index : null);
  }, [open, cell]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const later = (action: () => void, delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(action, delay);
  };

  /** The cell under a viewport point, through the canvas the face draws on. */
  const cellAtPoint = (clientX: number, clientY: number) => {
    if (!mosaic.current) return null;
    const rect = mosaic.current.canvas.getBoundingClientRect();
    return mosaic.current.controller.cellAt(clientX - rect.left, clientY - rect.top);
  };

  /** Points at a cell: measured from the canvas into this area's box, where the anchor is drawn. */
  const point = (next: MosaicCell | null) => {
    if (!next || !mosaic.current || !area.current) return;
    const canvas = mosaic.current.canvas.getBoundingClientRect();
    const box = area.current.getBoundingClientRect();
    setTarget({
      cell: next,
      anchor: { left: next.x + canvas.left - box.left, top: next.y + canvas.top - box.top, width: next.size, height: next.size },
    });
  };

  /** Opens a cell with the poster it shows right now (it may have swapped since it was pointed at). */
  const openAt = (index: number) => {
    const current = mosaic.current?.controller.cell(index);
    if (!current) return;
    point(current);
    setOpen(true);
  };

  const show = (next: MosaicCell | null, delay: number) => {
    if (!next) return;
    openedByKeyboard.current = false;
    point(next);
    later(() => openAt(next.index), open ? 0 : delay);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;
    const next = cellAtPoint(event.clientX, event.clientY);
    if (next && next.index !== cell?.index) show(next, OPEN_DELAY_MS);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return;
    show(cellAtPoint(event.clientX, event.clientY), 0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const controller = mosaic.current?.controller;
    if (!controller) return;
    const step = ARROW_STEPS[event.key];
    if (step) {
      event.preventDefault();
      const from = cell ?? cellAtPoint(area.current!.getBoundingClientRect().left + 1, area.current!.getBoundingClientRect().top + 1);
      point(controller.cell((from?.index ?? 0) + (cell ? step(controller.columns()) : 0)) ?? from);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && cell) {
      event.preventDefault();
      openedByKeyboard.current = true;
      openAt(cell.index);
    }
  };

  return (
    <LandingCard
      face={<EventPixelMosaic variant="band" onReady={onReady} />}
      corners={{
        "top-left": label === null
          ? <Skeleton className="h-6 w-48 rounded-xl" />
          : <LandingNotchLabel tone="new" icon={Sparkles}>{label}</LandingNotchLabel>,
      }}
    >
      <Popover open={open && manifest !== null && cell !== null} onOpenChange={setOpen}>
        <div
          ref={area}
          role="group"
          tabIndex={0}
          aria-label={label ?? undefined}
          className="group relative h-20 rounded-xl outline-none sm:h-32"
          onPointerMove={onPointerMove}
          onPointerLeave={() => later(() => setOpen(false), CLOSE_DELAY_MS)}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
        >
          {target ? (
            <PopoverAnchor asChild>
              {/* Positioned over the cell it opens from; the ring shows keyboard focus on that cell. */}
              <span
                className="pointer-events-none absolute rounded-[2px] group-focus-visible:ring-[3px] group-focus-visible:ring-ring/60"
                style={target.anchor}
              />
            </PopoverAnchor>
          ) : null}
        </div>
        {manifest && cell ? (
          <PopoverContent
            variant="media"
            side="top"
            collisionPadding={16}
            onPointerEnter={() => window.clearTimeout(timer.current)}
            onPointerLeave={() => later(() => setOpen(false), CLOSE_DELAY_MS)}
            onOpenAutoFocus={(event) => { if (!openedByKeyboard.current) event.preventDefault(); }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (openedByKeyboard.current) area.current?.focus();
            }}
          >
            <MosaicPosterDetails manifest={manifest} cell={cell} />
          </PopoverContent>
        ) : null}
      </Popover>
    </LandingCard>
  );
}
