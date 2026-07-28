import { lazy, Suspense, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { sanitizeHref } from "@/shared/utils/url";
import {
  formatCardDate,
  formatCardTime,
  formatCountdown,
  formatOccurrence,
  getPrimaryOccurrence,
} from "@/shared/utils/date";
import {
  Calendar,
  Discord,
  DollarSign,
  ExternalLink,
  Flag,
  Instagram,
  LocationPin,
  Share2,
  Utensils,
} from "@/shared/ui/doodle-icons";
import type { LucideIcon } from "@/shared/ui/doodle-icons";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Separator } from "@/shared/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { FormGrid, Stack } from "@/shared/layout";
import { EventCalendarDownloadMenu } from "@/features/events/components/EventCalendarDownloadMenu";
import { EventCardImage } from "@/features/events/components/EventCardImage";
import { EventLocationMap } from "@/features/events/components/EventLocationMap";
import { OrganizationTypeIcon } from "@/shared/components/OrganizationTypeIcon";
import { GoingOccurrencePickerContent } from "@/features/events/components/GoingOccurrencePickerContent";
import { fetchEventAttendees } from "@/features/events/api/events.api";
import { useCurrentTime, useGoingEventSelection } from "@/features/events/hooks/useGoingEvents";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import { appendSafeReturnTo, useAuthState } from "@/features/auth";
import { controlBox } from "@/shared/config/controlBox";
import { translateFood } from "@/shared/utils/foodTranslation";
import { queryKeys } from "@/shared/lib/queryKeys";
import { organizationPagePath, ROUTES } from "@/shared/constants/routes";
import type { Event } from "@/shared/types";

const EventShareDialog = lazy(() =>
  import("@/features/events/components/EventShareDialog").then((module) => ({
    default: module.EventShareDialog,
  })),
);
const EventReportDialog = lazy(() =>
  import("@/features/events/components/EventReportDialog").then((module) => ({
    default: module.EventReportDialog,
  })),
);

/**
 * Sections shared between the event details drawer and the dedicated
 * /events/[id] page so both surfaces render event data one way.
 */

/**
 * Section heading with divider.
 */
function EventSectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <Stack gap={2}>
      <h3 className="text-sm font-semibold text-foreground">{children}</h3>
      <Separator />
    </Stack>
  );
}

/** Organization name with its mapped organization-type icon. */
function EventHostName({ event }: { event: Event }) {
  const content = (
    <>
      <span>{event.organization}</span>
      <OrganizationTypeIcon
        school={event.school}
        organizationType={event.organization_type}
      />
    </>
  );

  if (event.organization_id != null) {
    return (
      <Link
        href={organizationPagePath(event.organization_id)}
        className="inline-flex items-center gap-1.5 text-foreground transition-colors hover:text-primary"
      >
        {content}
      </Link>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {content}
    </span>
  );
}

function EventDateTile({
  dtstartUtc,
  locale,
}: {
  dtstartUtc: string;
  locale: string;
}) {
  const start = new Date(dtstartUtc);
  if (Number.isNaN(start.getTime())) return null;
  return (
    <Card className="size-10 shrink-0 items-center justify-center gap-0.5 py-0">
      <span className="text-[9px] font-semibold">
        {start.toLocaleDateString(locale, { month: "short" })}
      </span>
      <span className="text-base font-bold leading-none">{start.getDate()}</span>
    </Card>
  );
}

/** Compact bordered squircle tile holding an icon, matching EventDateTile's footprint. */
function EventInfoTile({
  icon: Icon,
}: {
  icon: LucideIcon;
}) {
  return (
    <Card className="size-10 shrink-0 items-center justify-center py-0">
      <Icon className="size-4" />
    </Card>
  );
}

/** Date cell: primary occurrence plus a "+N dates" chip listing the rest. */
function EventDateCell({ event }: { event: Event }) {
  const { t, i18n } = useTranslation();
  const [extraDatesOpen, setExtraDatesOpen] = useState(false);
  const locale = i18n.language || "en-US";
  const primaryOccurrence = getPrimaryOccurrence(event);
  if (!primaryOccurrence) return null;
  const extraOccurrences = event.occurrences?.filter((occ) => occ !== primaryOccurrence) ?? [];

  return (
    <Stack direction="horizontal" gap={3} align="center">
      <EventDateTile
        dtstartUtc={primaryOccurrence.dtstart_utc}
        locale={locale}
      />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{formatCardDate(event, locale)}</p>
        <p className="text-sm text-muted-foreground">{formatCardTime(event)}</p>
        {extraOccurrences.length > 0 && (
          <Tooltip open={extraDatesOpen} onOpenChange={setExtraDatesOpen}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="mt-1 inline-flex items-center text-xs font-semibold px-2 py-0.5 bg-secondary text-secondary-foreground border border-border/80 rounded-full"
                onClick={(clickEvent) => {
                  clickEvent.preventDefault();
                  setExtraDatesOpen(true);
                }}
              >
                {t("events.moreDatesCount", { count: extraOccurrences.length })}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <div className="space-y-0.5">
                {extraOccurrences.map((occ) => (
                  <p key={occ.id || `${occ.dtstart_utc}-${occ.dtend_utc}`}>
                    {formatOccurrence(occ, t, locale)}
                  </p>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </Stack>
  );
}

function EventLocationCell({ event }: { event: Event }) {
  if (!event.location) return null;
  return (
    <Stack direction="horizontal" gap={3} align="center">
      <EventInfoTile icon={LocationPin} />
      <p className="min-w-0 text-sm font-semibold text-foreground">{event.location}</p>
    </Stack>
  );
}

function EventFoodCell({ event }: { event: Event }) {
  const { t } = useTranslation();
  if (!event.food || event.food.length === 0) return null;
  return (
    <Stack direction="horizontal" gap={3} align="center">
      <EventInfoTile icon={Utensils} />
      <p className="min-w-0 text-sm font-semibold text-foreground">
        {event.food.map((food) => translateFood(food, t)).join(", ")}
      </p>
    </Stack>
  );
}

function EventCostCell({ event }: { event: Event }) {
  const { t } = useTranslation();
  if (event.price == null) return null;
  return (
    <Stack direction="horizontal" gap={3} align="center">
      <EventInfoTile icon={DollarSign} />
      <p className="text-sm font-semibold text-foreground">
        {event.price === 0 ? t("common.free") : `$${event.price}`}
      </p>
    </Stack>
  );
}

/** Registration card: Register toggle (login-gated) plus calendar download. */
function EventRegistrationCard({
  event,
  school,
}: {
  event: Event;
  school: string | null | undefined;
}) {
  const { t } = useTranslation();
  const { profileCompleted, userEmail, userFullName, userAvatarUrl } = useAuthState();
  const going = useGoingEventSelection(event, school);
  const now = useCurrentTime();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const isGoingActive = profileCompleted && going.isActive;
  const displayName = userFullName || userEmail?.split("@")[0] || "";
  const firstName = displayName.split(" ")[0];

  const nextSelectedOccurrence = going.selectableOccurrences.find((occurrence) =>
    going.selectedSelectableIds.includes(occurrence.id),
  );
  const countdown =
    now !== null && nextSelectedOccurrence
      ? formatCountdown(new Date(nextSelectedOccurrence.dtstart_utc).getTime(), now)
      : null;

  if (isGoingActive && !pickerOpen) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("events.youreIn")}</CardTitle>
          {countdown ? (
            <CardAction>
              <Badge variant="secondary" size="lg">
                {t("events.startingIn")} {countdown}
              </Badge>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          <Stack gap={3}>
            {userAvatarUrl ? (
              <img src={userAvatarUrl} alt="" width={48} height={48} />
            ) : null}
            <Stack direction="horizontal" gap={2}>
              <EventCalendarDownloadMenu event={event}>
                <Button
                  type="button"
                  data-slot="dropdown-menu-trigger"
                >
                  <Calendar className="size-4" />
                  {t("common.addToCalendar")}
                </Button>
              </EventCalendarDownloadMenu>
              <Button type="button" variant="secondary" onClick={() => setShareOpen(true)}>
                <Share2 className="size-4" />
                {t("common.share")}
              </Button>
            </Stack>
            <CardDescription>
              {t("events.cancelRegistrationPrompt")}{" "}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={going.isPending}
                onClick={() => void going.saveSelection([])}
              >
                {t("events.cancelYourRegistration")}
              </Button>
            </CardDescription>
          </Stack>
          {shareOpen && (
            <Suspense fallback={null}>
              <EventShareDialog event={event} open={shareOpen} onOpenChange={setShareOpen} />
            </Suspense>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("common.registration")}</CardTitle>
      </CardHeader>
      <CardContent>
        {pickerOpen ? (
          <GoingOccurrencePickerContent
            key={`${event.id}:${going.selectedSelectableIds.join(",")}`}
            occurrences={going.selectableOccurrences}
            selectedIds={going.selectedSelectableIds}
            isPending={going.isPending}
            onCancel={() => setPickerOpen(false)}
            onConfirm={async (occurrenceIds) => {
              await going.saveSelection(occurrenceIds);
              setPickerOpen(false);
            }}
          />
        ) : (
          <Stack gap={3}>
            <CardDescription>
              {profileCompleted
                ? t("events.registrationWelcome", { name: firstName })
                : t("events.registrationWelcomeGuest")}
            </CardDescription>
            {profileCompleted ? (
              <Stack direction="horizontal" gap={2} align="center">
                {userAvatarUrl ? (
                  <img src={userAvatarUrl} alt="" width={24} height={24} />
                ) : null}
                <Stack gap={1}>
                  <CardTitle>{displayName}</CardTitle>
                  <CardDescription>{userEmail}</CardDescription>
                </Stack>
              </Stack>
            ) : null}
          </Stack>
        )}
      </CardContent>
      {!pickerOpen ? (
        <CardFooter className="w-full">
          {profileCompleted ? (
            <Button
              type="button"
              variant="primary"
              className="w-full"
              disabled={going.isPending || going.selectableOccurrences.length === 0}
              onClick={() => {
                if (going.selectableOccurrences.length > 1) {
                  setPickerOpen(true);
                  return;
                }
                const occurrence = going.selectableOccurrences[0];
                if (!occurrence) return;
                void going.saveSelection([occurrence.id]);
              }}
              aria-label={t("events.register")}
              title={t("events.register")}
            >
              {t("events.register")}
            </Button>
          ) : (
            <Button
              asChild
              variant="primary"
              className="w-full"
              aria-label={t("events.signInToRegister")}
              title={t("events.signInToRegister")}
            >
              <Link
                href={appendSafeReturnTo(
                  ROUTES.LOGIN,
                  eventPagePath(event.id),
                )}
              >
                {t("events.signInToRegister")}
              </Link>
            </Button>
          )}
        </CardFooter>
      ) : null}
    </Card>
  );
}

/** "About Event" heading, divider, description, and source link when present. */
function EventAboutSection({ event }: { event: Event }) {
  const { t } = useTranslation();
  const sourceHref = event.source_url ? sanitizeHref(event.source_url) : undefined;
  return (
    <Stack gap={3}>
      <EventSectionHeader>{t("events.aboutEvent")}</EventSectionHeader>
      <p className="whitespace-pre-line text-sm text-muted-foreground">
        {event.description || t("common.noDescription")}
      </p>
      {sourceHref && (
        <a
          href={sourceHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:underline flex items-center gap-1.5"
        >
          <ExternalLink className="size-3.5" />
          <span className="truncate">{event.source_url}</span>
        </a>
      )}
    </Stack>
  );
}

/** Full-width embedded map for a physical event location. */
function EventMapSection({
  event,
  school,
}: {
  event: Event;
  school: string | null | undefined;
}) {
  return <EventLocationMap location={event.location} school={event.school ?? school} />;
}

/** "N going" heading, divider, and abbreviated attendee names. */
function EventAttendeesSection({ eventId }: { eventId: number }) {
  const { t } = useTranslation();
  const { data: attendees } = useQuery({
    queryKey: queryKeys.events.attendees(eventId),
    queryFn: () => fetchEventAttendees(eventId),
    staleTime: controlBox.clientCache.liveEventDataStaleMs,
  });
  if (!attendees || attendees.going_count <= 0) return null;

  const overflowCount = attendees.going_count - attendees.names.length;
  return (
    <Stack gap={3}>
      <EventSectionHeader>
        {t("events.goingCount", { count: attendees.going_count })}
      </EventSectionHeader>
      {attendees.names.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {attendees.names.join(", ")}
          {overflowCount > 0 && ` ${t("events.andOthersCount", { count: overflowCount })}`}
        </p>
      )}
    </Stack>
  );
}

/** "Contact the Host" links from the owning organization's socials. */
function EventContactHostSection({ event }: { event: Event }) {
  const { t } = useTranslation();
  const igHandle = event.organization_ig ?? event.ig_handle;
  const igHref = igHandle
    ? igHandle.startsWith("http")
      ? igHandle
      : `https://instagram.com/${igHandle}`
    : undefined;
  const allLinks: { href: string | undefined; label: string; Icon: LucideIcon }[] = [
    {
      href: event.organization_page ?? undefined,
      label: t("organizations.visitWebsite"),
      Icon: ExternalLink,
    },
    { href: igHref, label: t("organizations.instagram"), Icon: Instagram },
    {
      href: event.organization_discord ?? undefined,
      label: t("organizations.discord"),
      Icon: Discord,
    },
  ];
  const links = allLinks.filter(
    (link): link is { href: string; label: string; Icon: LucideIcon } => Boolean(link.href),
  );
  if (links.length === 0) return null;

  return (
    <Stack gap={3}>
      <EventSectionHeader>{t("events.contactHost")}</EventSectionHeader>
      <Stack direction="horizontal" gap={4} className="flex-wrap">
        {links.map((link) => (
          <a
            key={link.label}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline flex items-center gap-1.5"
          >
            <link.Icon className="size-3.5" />
            {link.label}
          </a>
        ))}
      </Stack>
    </Stack>
  );
}

/** Share and report actions, owning their own dialogs. */
export function EventActions({ event }: { event: Event }) {
  const { t } = useTranslation();
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <Stack direction="horizontal" gap={2} wrap>
      <Button type="button" variant="secondary" size="sm" onClick={() => setShareOpen(true)}>
        <Share2 className="size-4" />
        {t("common.share")}
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={() => setReportOpen(true)}>
        <Flag className="size-4" />
        {t("common.report")}
      </Button>
      {shareOpen && (
        <Suspense fallback={null}>
          <EventShareDialog event={event} open={shareOpen} onOpenChange={setShareOpen} />
        </Suspense>
      )}
      {reportOpen && (
        <Suspense fallback={null}>
          <EventReportDialog
            eventId={event.id}
            eventTitle={event.title}
            open={reportOpen}
            onOpenChange={setReportOpen}
          />
        </Suspense>
      )}
    </Stack>
  );
}

/**
 * Full event details layout shared by the drawer and the /events/[id] page:
 * single column on mobile, poster + hosts sidebar next to details on md+.
 * Mobile stacking order: poster, title, hosts/going, then event details.
 */
export function EventDetailsBody({
  event,
  school,
  renderTitle,
}: {
  event: Event;
  school: string | null | undefined;
  /** Override the title element (the drawer supplies its DrawerTitle). */
  renderTitle?: (title: string) => React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[320px_minmax(0,1fr)] md:grid-rows-[auto_1fr] md:items-start md:gap-x-8">
      <div
        className="mx-auto w-full max-w-sm select-none md:col-start-1 md:mx-0"
        onDragStart={(dragEvent) => dragEvent.preventDefault()}
      >
        <EventCardImage event={event} variant="detail" />
      </div>

      <div className="contents md:col-start-2 md:row-span-2 md:row-start-1 md:flex md:flex-col md:gap-6">
        <div className="order-1">
          {renderTitle ? (
            renderTitle(event.title)
          ) : (
            <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{event.title}</h1>
          )}
        </div>

        <Stack gap={6} className="order-3">
          <FormGrid columns={2} collapse={false}>
            <EventDateCell event={event} />
            <EventLocationCell event={event} />
            <EventFoodCell event={event} />
            <EventCostCell event={event} />
          </FormGrid>

          <EventRegistrationCard event={event} school={school} />

          <EventAboutSection event={event} />

          <EventMapSection event={event} school={school} />
        </Stack>
      </div>

      <Stack gap={6} className="order-2 md:col-start-1">
        <Stack gap={3}>
          <EventSectionHeader>{t("events.hostedBy")}</EventSectionHeader>
          <p className="text-sm text-muted-foreground">
            <EventHostName event={event} />
          </p>
        </Stack>

        <EventAttendeesSection eventId={event.id} />

        <EventContactHostSection event={event} />
      </Stack>

    </div>
  );
}
