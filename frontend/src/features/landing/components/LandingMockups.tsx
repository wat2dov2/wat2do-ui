"use client";

/**
 * Illustrations of real Wat2Do surfaces for the landing page's feature rows.
 * They borrow the product's own primitives and labels so they stay true to the
 * app as it changes, and they are decorative: nothing in them is interactive.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Stack } from "@/shared/layout";
import { Badge } from "@/shared/ui/badge";
import { ArrowRight, Calendar, Clock, DollarSign, Instagram, MapPin, Mail, Search, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";

/** The white card every mockup sets its product surface on. */
function MockSurface({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("w-full rounded-xl border border-border bg-background p-4 shadow-sm", className)}>
      {children}
    </div>
  );
}

function MockLine({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

/** A club's Instagram post turning into a searchable event card. */
export function CaptureMockup() {
  const { t } = useTranslation();

  return (
    <Stack direction="horizontal" gap={4} align="center" justify="center" className="w-full" aria-hidden="true">
      <div className="flex w-32 shrink-0 flex-col gap-2 rounded-xl border border-border bg-background p-2 sm:w-36">
        <span className="flex min-w-0 items-center gap-1 text-[11px] font-semibold text-foreground">
          <Instagram className="size-3.5 shrink-0" />
          <span className="truncate">{t("landing.features.capture.mockHandle")}</span>
        </span>
        <div className="flex aspect-square flex-col justify-end gap-1.5 rounded-lg bg-primary p-2.5">
          <span className="h-2 w-4/5 rounded-full bg-primary-foreground/80" />
          <span className="h-2 w-3/5 rounded-full bg-primary-foreground/50" />
        </div>
      </div>
      <ArrowRight className="size-6 shrink-0 text-muted-foreground" />
      <MockSurface className="max-w-60">
        <Stack gap={3}>
          <Badge variant="new" size="md">{t("events.new")}</Badge>
          <p className="font-bold leading-tight text-foreground">
            {t("landing.features.capture.mockTitle")}
          </p>
          <Stack gap={1}>
            <MockLine icon={Calendar}>{t("landing.features.capture.mockDate")}</MockLine>
            <MockLine icon={MapPin}>{t("landing.features.capture.mockPlace")}</MockLine>
            <MockLine icon={DollarSign}>{t("landing.features.capture.mockPrice")}</MockLine>
          </Stack>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Sparkles className="size-3.5" />
            {t("landing.features.capture.mockAdded")}
          </span>
        </Stack>
      </MockSurface>
    </Stack>
  );
}

/** The search bar and the quick filters students reach for first. */
export function FiltersMockup() {
  const { t } = useTranslation();
  const quickFilters = [
    t("filters.employersOnCampus"),
    t("filters.competitions"),
    t("filters.forYou"),
  ];

  return (
    <MockSurface className="max-w-md">
      <Stack gap={4} aria-hidden="true">
        <span className="flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm text-foreground">
          <Search className="size-4 text-muted-foreground" />
          {t("landing.features.filters.mockQuery")}
        </span>
        <Stack direction="horizontal" gap={2} wrap>
          <Badge variant="default" size="xl">{t("filters.freeFoodOnCampus")}</Badge>
          {quickFilters.map((label) => (
            <Badge key={label} variant="outline" size="xl">{label}</Badge>
          ))}
        </Stack>
      </Stack>
    </MockSurface>
  );
}

/** The reminder email a Going tap sets up, and the calendar it lands in. */
export function RemindersMockup() {
  const { t } = useTranslation();

  return (
    <Stack gap={3} className="w-full max-w-md" aria-hidden="true">
      <MockSurface>
        <Stack direction="horizontal" gap={3} align="start">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Mail className="size-4" />
          </span>
          <Stack gap={1}>
            <p className="text-sm font-bold text-foreground">
              {t("landing.features.reminders.mockSubject")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("landing.features.reminders.mockBody")}
            </p>
          </Stack>
        </Stack>
      </MockSurface>
      <Stack direction="horizontal" gap={2} wrap>
        <Badge variant="going" size="xl">{t("common.going")}</Badge>
        <Badge variant="outline" size="xl" className="gap-1.5">
          <Calendar className="size-3.5" />
          {t("events.calendar.googleCalendar")}
        </Badge>
        <Badge variant="outline" size="xl" className="gap-1.5">
          <Clock className="size-3.5" />
          {t("landing.features.reminders.mockMorning")}
        </Badge>
      </Stack>
    </Stack>
  );
}

const MOCK_CLUBS = ["mockClubOne", "mockClubTwo", "mockClubThree"] as const;

/** A slice of the club directory with clubs most students never knew about. */
export function ClubsMockup() {
  const { t } = useTranslation();

  return (
    <MockSurface className="max-w-md p-2">
      <Stack gap={1} aria-hidden="true">
        {MOCK_CLUBS.map((key, index) => {
          const name = t(`landing.features.clubs.${key}`);
          return (
            <Stack key={key} direction="horizontal" gap={3} align="center" className="rounded-lg p-2">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-foreground">
                {name.charAt(0)}
              </span>
              <Stack gap={1} grow>
                <p className="font-semibold leading-tight text-foreground">{name}</p>
                <p className="text-sm text-muted-foreground">
                  {t("landing.features.clubs.mockUpcoming", { count: index + 1 })}
                </p>
              </Stack>
              <Badge variant={index === 0 ? "default" : "outline"} size="lg">
                {t(index === 0 ? "landing.features.clubs.mockFollowing" : "landing.features.clubs.mockFollow")}
              </Badge>
            </Stack>
          );
        })}
      </Stack>
    </MockSurface>
  );
}
