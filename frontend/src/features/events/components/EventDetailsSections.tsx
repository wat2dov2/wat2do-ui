import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode, type Ref } from "react";
import { useEventView } from "@/features/events/hooks/useEventStats";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { sanitizeHref } from "@/shared/utils/url";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import {
  formatCardDate,
  formatCardTime,
  formatCountdown,
  formatOccurrence,
  getPrimaryOccurrence,
  hasActiveEventOccurrence,
} from "@/shared/utils/date";
import { Calendar, DollarSign, Edit, Flag, MapPin, Share2, Ticket, Trash2, Utensils } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { DateTile, IconTile } from "@/shared/ui/tile";
import { Link } from "@/shared/ui/link";
import { Button } from "@/shared/ui/button";
import { LoadingButton } from "@/shared/ui/loading-button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { AddedAt } from "@/shared/ui/added-at";
import { Separator } from "@/shared/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { FormGrid, Section, Stack } from "@/shared/layout";
import { CARD_GRID_CLASS } from "@/shared/constants/ui";
import { EventCalendarDownloadMenu } from "@/features/events/components/EventCalendarDownloadMenu";
import { EventCard } from "@/features/events/components/EventCard";
import { EventCardSkeleton } from "@/features/events/components/EventCardSkeleton";
import { EventCardImage } from "@/features/events/components/EventCardImage";
import { cn } from "@/shared/lib/utils";
import { PosterTitleArt } from "@/features/events/components/PosterTitleArt";
import { eventTitleSvg } from "@/features/events/lib/titleSvg";
import { EventLocationMap } from "@/features/events/components/EventLocationMap";
import { ClubBadgeLink } from "@/features/clubs";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { LazyImage } from "@/shared/ui/lazy-image";
import { GoingOccurrencePickerContent } from "@/features/events/components/GoingOccurrencePickerContent";
import { SaveEventButton, SaveEventButtonPlaceholder } from "@/features/events/components/SaveEventButton";
import { deleteEventAPI, fetchEventAttendees } from "@/features/events/api/events.api";
import { useEventStats } from "@/features/events/hooks/useEventStats";
import { useCurrentTime, useGoingEventSelection } from "@/features/events/hooks/useGoingEvents";
import { EmailOtpForm } from "@/features/auth/components/EmailOtpForm";
import { ClubManagerView, SessionView } from "@/features/auth/components/SessionView";
import { useAuthState, useSessionKnown } from "@/features/auth/hooks/useAuthState";
import { useUIStore } from "@/shared/store/ui.store";
import { controlBox } from "@/shared/config/controlBox";
import { translateFoods } from "@/shared/utils/foodTranslation";
import { queryKeys } from "@/shared/lib/queryKeys";
import { ROUTES } from "@/shared/constants/routes";
import {
  EventTicketCard,
  HeldTicket,
  TicketDatePicker,
  currentTicketPriceCents,
  useEventTicketing,
  useFreeTicket,
  useTicketUnavailableText,
} from "@/features/tickets";
import type { ApiEventTicketingResponse } from "@/shared/generated";
import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";
import { formatCents } from "@/shared/utils/currency";
import { toast } from "@/shared/hooks/use-toast";
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
const AdminDeleteDialog = lazy(() =>
  import("@/features/admin/components/shared/AdminDeleteDialog").then((module) => ({
    default: module.AdminDeleteDialog,
  })),
);

/**
 * Sections shared between the event details drawer and the dedicated
 * /events/[id] page so both surfaces render event data one way.
 */

/** The details layout, shared with its loading skeleton so both take the same boxes. */
export const EVENT_DETAILS_LAYOUT = {
  grid: "grid grid-cols-1 gap-6 md:grid-cols-[320px_minmax(0,1fr)] md:grid-rows-[auto_1fr] md:items-start md:gap-x-8",
  poster: "mx-auto w-full max-w-sm select-none md:col-start-1 md:mx-0",
  details: "contents md:col-start-2 md:row-span-2 md:row-start-1 md:flex md:flex-col md:gap-6",
  title: "text-2xl font-bold leading-tight sm:text-3xl",
  sidebar: "order-2 md:col-start-1",
};

/** Date cell: primary occurrence plus a "+N dates" chip listing the rest. */
function EventDateCell({ event }: { event: Event }) {
  const { getSchoolTimezone } = useSchoolDirectory();
  const timeZone = getSchoolTimezone(event.school);
  const { t, i18n } = useTranslation();
  const [extraDatesOpen, setExtraDatesOpen] = useState(false);
  const locale = i18n.language || "en-US";
  const primaryOccurrence = getPrimaryOccurrence(event);
  if (!primaryOccurrence) return null;
  const extraOccurrences = event.occurrences?.filter((occ) => occ !== primaryOccurrence) ?? [];

  return (
    <Stack direction="horizontal" gap={3} align="center">
      <DateTile dtstartUtc={primaryOccurrence.dtstart_utc} locale={locale} timeZone={timeZone} />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{formatCardDate(event, timeZone, locale)}</p>
        <p className="text-sm text-muted-foreground">{formatCardTime(event, timeZone, locale)}</p>
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
                    {formatOccurrence(occ, timeZone, locale)}
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

/** One fact in the details grid, beside its icon tile. */
function EventFact({ icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <Stack direction="horizontal" gap={3} align="center">
      <IconTile icon={icon} />
      <p className="min-w-0 text-sm font-semibold text-foreground">{children}</p>
    </Stack>
  );
}

function EventLocationCell({ event }: { event: Event }) {
  if (!event.location) return null;
  return <EventFact icon={MapPin}>{event.location}</EventFact>;
}

function EventFoodCell({ event }: { event: Event }) {
  const { t } = useTranslation();
  if (!event.food || event.food.length === 0) return null;
  return <EventFact icon={Utensils}>{translateFoods(event.food, t)}</EventFact>;
}

/** The same ticket the event's card badge shows for registration. */
function EventRegistrationCell({ event }: { event: Event }) {
  const { t } = useTranslation();
  if (!event.registration) return null;
  return <EventFact icon={Ticket}>{t("common.registrationRequired")}</EventFact>;
}

function EventCostCell({ event }: { event: Event }) {
  const { t, i18n } = useTranslation();
  // An event with tickets costs what its tickets cost.
  const { data: ticketing } = useEventTicketing(ticketedEventId(event));
  const cost = ticketing
    ? ticketing.free
      ? t("common.free")
      : formatCents(currentTicketPriceCents(ticketing), ticketing.currency ?? "cad", i18n.language)
    : event.price == null
      ? null
      : event.price === 0
        ? t("common.free")
        : `$${event.price}`;
  if (cost == null) return null;
  return <EventFact icon={DollarSign}>{cost}</EventFact>;
}

/**
 * The event to look up tickets for, or null. Turning tickets on also marks
 * the event as needing registration, so most events never wait on the lookup.
 */
function ticketedEventId(event: Event): number | null {
  return event.registration && event.id > 0 ? event.id : null;
}

/**
 * The event's main action. With tickets on, Get tickets (free in a tap, paid
 * through Stripe), which also turns on Notify me for that date; its dates
 * without tickets still offer Notify me. Otherwise Notify me: a reminder
 * before it starts and an email when it changes.
 */
function EventAdmissionCard({
  event,
  school,
}: {
  event: Event;
  school: string | null | undefined;
}) {
  const ticketedId = ticketedEventId(event);
  const { data: ticketing, isPending } = useEventTicketing(ticketedId);
  if (ticketedId != null && isPending) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }
  if (!ticketing) return <EventNotifyMeCard event={event} school={school} />;
  const ticketed = new Set(ticketing.dates.map((date) => date.event_date_id));
  const otherDates = (event.occurrences ?? [])
    .map((occurrence) => occurrence.id)
    .filter((id) => !ticketed.has(id));
  return (
    <Stack gap={6}>
      {ticketing.free ? (
        <EventFreeTicketCard event={event} school={school} ticketing={ticketing} />
      ) : (
        <EventTicketCard event={event} ticketing={ticketing} />
      )}
      {otherDates.length > 0 ? (
        <EventNotifyMeCard event={event} school={school} dates={otherDates} />
      ) : null}
    </Stack>
  );
}

/**
 * Free tickets: one tap (or the email sign-in that leads to it), and the
 * ticket comes with a QR code the club scans at the door.
 */
function EventFreeTicketCard({
  event,
  school,
  ticketing,
}: {
  event: Event;
  school: string | null | undefined;
  ticketing: ApiEventTicketingResponse;
}) {
  const { t } = useTranslation();
  const free = useFreeTicket(event, ticketing);
  const now = useCurrentTime(event.occurrences);
  // "Get tickets for another date" stays open until that ticket lands.
  const [addingAt, setAddingAt] = useState<number | null>(null);
  const adding = addingAt === free.held.length;
  const unavailableText = useTicketUnavailableText(event, ticketing, free.unavailable);
  // The count of what is left rides in the button, when the club set a limit.
  const getLabel =
    free.remaining == null
      ? t("tickets.card.get")
      : t("tickets.card.getLeft", { count: free.remaining });
  const datePicker = (
    <TicketDatePicker
      event={event}
      dates={free.openDates}
      selectedDateId={free.selectedDateId}
      onSelect={free.selectDate}
    />
  );

  if (free.held.length) {
    const nextStartMs = free.held
      .map((ticket) => new Date(ticket.dtstart_utc).getTime())
      .filter((startMs) => now !== null && startMs > now)
      .sort((a, b) => a - b)[0];
    const countdown =
      now !== null && nextStartMs !== undefined ? formatCountdown(nextStartMs, now) : null;
    const another = free.unavailable ? null : adding ? (
      <Stack gap={3}>
        {datePicker}
        <LoadingButton type="button" isLoading={free.isPending} onClick={free.take}>
          {getLabel}
        </LoadingButton>
      </Stack>
    ) : (
      <Stack align="start">
        <Button
          type="button"
          variant="link"
          size="inline"
          onClick={() => setAddingAt(free.held.length)}
        >
          {t("tickets.card.anotherDate")}
        </Button>
      </Stack>
    );
    return (
      <EventYoureInCard title={t("events.youreIn")} event={event} countdown={countdown} footer={another}>
        <CardDescription>{t("tickets.card.showAtDoor")}</CardDescription>
        {free.held.map((ticket) => (
          <HeldTicket key={ticket.code} ticket={ticket} event={event} />
        ))}
      </EventYoureInCard>
    );
  }

  return (
    <EventRegistrationPrompt
      school={event.school ?? school}
      label={getLabel}
      unavailable={free.unavailable !== null}
      unavailableReason={unavailableText}
      isPending={free.isPending}
      onRegister={free.take}
    >
      {free.unavailable ? (
        <CardDescription>{unavailableText}</CardDescription>
      ) : (
        <>
          {datePicker}
          <CardDescription>
            {t("tickets.card.checkInNote", { club: event.club ?? t("tickets.refund.theClub") })}
          </CardDescription>
        </>
      )}
    </EventRegistrationPrompt>
  );
}

/**
 * The card once someone is in, or has Notify me on: a countdown, what they
 * bring (the QR code a ticket comes with), add to calendar and share, then
 * the way out.
 */
function EventYoureInCard({
  title,
  event,
  countdown,
  children,
  footer,
}: {
  title: string;
  event: Event;
  countdown: string | null;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const [shareOpen, setShareOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
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
          {children}
          <Stack direction="horizontal" gap={2}>
            <EventCalendarDownloadMenu event={event}>
              <Button type="button" data-slot="dropdown-menu-trigger">
                <Calendar className="size-4" />
                {t("common.addToCalendar")}
              </Button>
            </EventCalendarDownloadMenu>
            <Button type="button" variant="outline" onClick={() => setShareOpen(true)}>
              <Share2 className="size-4" />
              {t("common.share")}
            </Button>
          </Stack>
          {footer}
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

/**
 * Notify me: a reminder before the event and an email when it changes. Only
 * the person themselves sees that they turned it on. With `dates`, it covers
 * only those dates (an event's dates without tickets).
 */
function EventNotifyMeCard({
  event,
  school,
  dates,
}: {
  event: Event;
  school: string | null | undefined;
  dates?: readonly string[];
}) {
  const { t } = useTranslation();
  const { profileCompleted } = useAuthState();
  const notify = useGoingEventSelection(event, school, dates);
  const { getSchoolTimezone } = useSchoolDirectory();
  const now = notify.currentTimeMs;
  const [pickerOpen, setPickerOpen] = useState(false);
  const isOn = profileCompleted && notify.isActive;
  const disabledReason = notify.isTimeUnavailable
    ? t("events.goingEvents.timeUnavailable")
    : undefined;

  const nextSelectedOccurrence = notify.selectableOccurrences.find((occurrence) =>
    notify.selectedSelectableIds.includes(occurrence.id),
  );
  const countdown =
    now !== null && nextSelectedOccurrence
      ? formatCountdown(new Date(nextSelectedOccurrence.dtstart_utc).getTime(), now)
      : null;

  const turnOn = async () => {
    if (!notify.canRegisterNow()) return;
    if (notify.selectableOccurrences.length > 1) {
      setPickerOpen(true);
      return;
    }

    const occurrence = notify.selectableOccurrences[0];
    if (!occurrence) {
      return;
    }

    try {
      await notify.saveSelection([occurrence.id]);
    } catch {
      // The going-events hook owns the user-facing failure toast.
    }
  };

  // Beside tickets, the dates without them offer Notify me only while one is still to come.
  if (dates && !isOn && notify.isTimeUnavailable) return null;

  if (isOn && !pickerOpen) {
    return (
      <EventYoureInCard
        title={t("events.notifyMe.onTitle")}
        event={event}
        countdown={countdown}
        footer={
          <CardDescription>
            {t("events.notifyMe.offPrompt")}{" "}
            <Button
              type="button"
              variant="link"
              size="inline"
              disabled={notify.isPending}
              onClick={() => void notify.saveSelection([])}
            >
              {t("events.notifyMe.off")}
            </Button>
          </CardDescription>
        }
      >
        <CardDescription>{t("events.notifyMe.onDescription")}</CardDescription>
      </EventYoureInCard>
    );
  }

  if (pickerOpen) {
    return (
      <Card>
        <CardContent>
          <GoingOccurrencePickerContent
            timeZone={getSchoolTimezone(event.school)}
            key={`${event.id}:${notify.selectedSelectableIds.join(",")}`}
            occurrences={notify.selectableOccurrences}
            selectedIds={notify.selectedSelectableIds}
            isPending={notify.isPending}
            onCancel={() => setPickerOpen(false)}
            onConfirm={async (occurrenceIds) => {
              await notify.saveSelection(occurrenceIds);
              setPickerOpen(false);
            }}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <EventRegistrationPrompt
      school={event.school ?? school}
      unavailable={notify.selectableOccurrences.length === 0}
      unavailableReason={disabledReason}
      isPending={notify.isPending}
      onRegister={turnOn}
    >
      <CardDescription>
        {t(dates ? "events.notifyMe.otherDates" : "events.notifyMe.description")}
      </CardDescription>
    </EventRegistrationPrompt>
  );
}

/**
 * The main action before it is taken: the visitor's account with a Notify me
 * (or Get tickets) button, or the email sign-in that leads to it. The event's
 * loading state shows this same card, so it keeps its size when the event arrives.
 */
export function EventRegistrationPrompt({
  school,
  label,
  unavailable,
  unavailableReason,
  isPending,
  onRegister,
  children,
}: {
  school: string | null | undefined;
  /** The button's words: Notify me, or Get tickets for an event with free tickets. */
  label?: string;
  unavailable: boolean;
  unavailableReason?: string;
  isPending: boolean;
  onRegister: () => void | Promise<void>;
  /** Shown under the account, e.g. which date a ticket is for. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const action = label ?? t("events.notifyMe.action");
  const { userEmail, userFullName, userAvatarUrl } = useAuthState();
  // Until the page wakes up, who is signed in is not known: the signed-in look holds their lines' places.
  const sessionKnown = useSessionKnown();
  const displayName = userFullName || userEmail?.split("@")[0] || "";
  return (
    <Card>
      <CardContent>
        <Stack gap={3}>
          <SessionView
            signedIn={
              <Stack direction="horizontal" gap={2} align="center">
                {sessionKnown ? (
                  userAvatarUrl ? (
                    <LazyImage src={userAvatarUrl} alt="" width={24} height={24} className="size-6" fallback={null} />
                  ) : null
                ) : (
                  // The picture's place, kept when the cached sign-in has one (see sessionInitScript).
                  <span aria-hidden="true" className="hidden size-6 shrink-0 in-data-[session-avatar]:block" />
                )}
                <Stack gap={1}>
                  <CardTitle>{sessionKnown ? displayName : <SkeletonLine className="w-28" />}</CardTitle>
                  <CardDescription>{sessionKnown ? userEmail : <SkeletonLine className="w-40" />}</CardDescription>
                </Stack>
              </Stack>
            }
            signedOut={
              <EmailOtpForm
                data-testid="event-registration-auth"
                school={school}
                requestCodeLabel={action}
                actionLabel={action}
                focusOnMount={false}
                isSubmitDisabled={unavailable}
                submitDisabledReason={unavailableReason}
                onAuthenticated={onRegister}
              />
            }
          />
          {children}
        </Stack>
      </CardContent>
      <SessionView
        signedIn={
          <CardFooter className="w-full">
            <Button
              type="button"
              variant="primary"
              className="w-full"
              disabled={isPending || unavailable}
              disabledReason={unavailableReason}
              onClick={() => void onRegister()}
              aria-label={action}
            >
              {action}
            </Button>
          </CardFooter>
        }
        signedOut={null}
      />
    </Card>
  );
}

/** "About Event" heading, divider and description. */
function EventAboutSection({
  event,
  isFetchingDetails,
}: {
  event: Event;
  isFetchingDetails: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Section variant="divided" title={t("events.aboutEvent")}>
      <p className="whitespace-pre-line text-sm text-muted-foreground">
        {event.description ||
          t(isFetchingDetails ? "events.fetchingDetails" : "common.noDescription")}
      </p>
    </Section>
  );
}

/** "Source URL" heading and divider, as About Event has, over the link the event was announced at. */
function EventSourceSection({ event }: { event: Event }) {
  const { t } = useTranslation();
  const sourceHref = event.source_url ? sanitizeHref(event.source_url) : undefined;
  if (!sourceHref) return null;
  return (
    <Section variant="divided" title={t("events.sourceUrl")}>
      <p className="truncate text-sm">
        <Link href={sourceHref} target="_blank" rel="noopener noreferrer">
          {event.source_url}
        </Link>
      </p>
    </Section>
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
  return <EventLocationMap location={event.map_location} school={event.school ?? school} />;
}

/**
 * Who's going: the event's Going count and the first people who marked it,
 * shown as "First L." with their photo. Ticket holders count but are never
 * named. Shared by the drawer and the event page.
 */
function EventAttendeesSection({ eventId }: { eventId: number }) {
  const { t } = useTranslation();
  const { data: attendees } = useQuery({
    queryKey: queryKeys.events.attendees(eventId),
    queryFn: () => fetchEventAttendees(eventId),
    staleTime: controlBox.clientCache.liveEventDataStaleMs,
    enabled: eventId > 0,
  });
  if (!attendees || attendees.going_count <= 0) return null;

  const { maximumDisplayNames } = controlBox.publicAttendance;
  const profiles = attendees.attendees.slice(0, maximumDisplayNames);
  // Ticket holders are counted but never named, so "+N" shows only once the names fill the list.
  const overflowCount = profiles.length === maximumDisplayNames
    ? Math.max(0, attendees.going_count - profiles.length)
    : 0;
  return (
    <Section variant="divided" title={t("events.goingCount", { count: attendees.going_count })} data-slot="event-attendees">
      <AvatarStack
        avatars={profiles.map((attendee) => ({
          name: attendee.name || t("events.going"),
          src: attendee.avatar_url,
        }))}
        overflowCount={overflowCount}
        overflowLabel={t("events.andOthersCount", { count: overflowCount })}
      />
    </Section>
  );
}

/**
 * The actions everyone sees, inert, while the event loads. Members who manage
 * the event see more once it arrives.
 */
export function EventActionsPlaceholder({ clubId }: {
  /**
   * The event's club when it is already known (opened from a list), so its team's
   * controls hold their places too; admins' edit and delete always do.
   */
  clubId?: number | null;
}) {
  const { t } = useTranslation();
  return (
    <Stack direction="horizontal" gap={2} wrap data-slot="event-actions" aria-hidden="true">
      <Button type="button" variant="outline" size="sm" disabled tabIndex={-1}>
        <Calendar className="size-4" />
        {t("common.addToCalendar")}
      </Button>
      <ClubManagerView clubId={clubId}>
        <Button type="button" variant="outline" size="sm" disabled tabIndex={-1}>
          <Edit className="size-4" />
          {t("common.edit")}
        </Button>
        <Button type="button" variant="destructive" size="sm" disabled tabIndex={-1}>
          <Trash2 className="size-4" />
          {t("common.delete")}
        </Button>
      </ClubManagerView>
      <SaveEventButtonPlaceholder />
      <Button type="button" variant="outline" size="sm" disabled tabIndex={-1}>
        <Share2 className="size-4" />
        {t("common.share")}
      </Button>
      <Button type="button" variant="outline" size="sm" disabled tabIndex={-1}>
        <Flag className="size-4" />
        {t("common.report")}
      </Button>
    </Stack>
  );
}

/** Save, share and report actions, owning their own dialogs. */
export function EventActions({
  event,
  onBeforeEdit,
  onDeleted,
}: {
  event: Event;
  /**
   * Dismiss the surface holding these actions before the editor opens. The
   * drawer passes its close so the edit dialog does not stack on top of it;
   * the standalone event page has nothing to dismiss and omits it.
   */
  onBeforeEdit?: () => void;
  /** Close the containing surface after deletion; dedicated pages navigate home. */
  onDeleted?: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const setEditingEvent = useUIStore((s) => s.setEditingEvent);

  const handleEdit = useCallback(() => {
    onBeforeEdit?.();
    setEditingEvent(event);
  }, [event, onBeforeEdit, setEditingEvent]);

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await deleteEventAPI(event.id);
      setDeleteOpen(false);
      if (onDeleted) {
        onDeleted();
      } else {
        router.replace(ROUTES.EVENTS);
        router.refresh();
      }
    } catch {
      toast({
        description: t("events.deleteFailed"),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  }, [event.id, onDeleted, router, t]);

  return (
    <Stack direction="horizontal" gap={2} wrap data-slot="event-actions">
      <EventCalendarDownloadMenu event={event}>
        <Button type="button" variant="outline" size="sm">
          <Calendar className="size-4" />
          {t("common.addToCalendar")}
        </Button>
      </EventCalendarDownloadMenu>
      {/* Admins and the hosting club's own members can edit and delete it; the server checks the same. */}
      <ClubManagerView clubId={event.club_id}>
        <Button type="button" variant="outline" size="sm" onClick={handleEdit}>
          <Edit className="size-4" />
          {t("common.edit")}
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="size-4" />
          {t("common.delete")}
        </Button>
      </ClubManagerView>
      <SaveEventButton eventId={event.id} />
      <Button type="button" variant="outline" size="sm" onClick={() => setShareOpen(true)}>
        <Share2 className="size-4" />
        {t("common.share")}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => setReportOpen(true)}>
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
      {deleteOpen && (
        <Suspense fallback={null}>
          <AdminDeleteDialog
            isOpen={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            onConfirm={handleDelete}
            title={t("events.deleteEventTitle")}
            description={t("events.deleteEventConfirm", { title: event.title })}
            isLoading={isDeleting}
          />
        </Suspense>
      )}
    </Stack>
  );
}

/**
 * Full event details layout shared by the drawer and the /events/[id] page:
 * single column on mobile, poster + hosts sidebar next to details on md+.
 * Mobile stacking order: poster, title, hosts and who's going, then event details.
 */
export function EventDetailsBody({
  event,
  school,
  isFetchingDetails = false,
  renderTitle,
  onClubNavigate,
}: {
  event: Event;
  school: string | null | undefined;
  isFetchingDetails?: boolean;
  /** Override the title element (the drawer supplies its DrawerTitle). */
  renderTitle?: (title: string) => React.ReactNode;
  /** Lets drawer composition close after its club filter is applied. */
  onClubNavigate?: () => void;
}) {
  useEventView(event.id, event.school);
  const { t } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const titleSvg = eventTitleSvg(event);
  return (
    <div className={EVENT_DETAILS_LAYOUT.grid}>
      <div
        className={EVENT_DETAILS_LAYOUT.poster}
        onDragStart={(dragEvent) => dragEvent.preventDefault()}
      >
        <EventCardImage
          event={event}
          variant="detail"
          onClubNavigate={onClubNavigate}
        />
      </div>

      <div className={EVENT_DETAILS_LAYOUT.details}>
        <Stack gap={2} className="order-1" data-skeleton-key="event-title">
          {/* A title its poster sets is shown as the poster sets it; the heading stays for screen readers. */}
          {titleSvg ? <PosterTitleArt svg={titleSvg} variant="heading" /> : null}
          <div className={cn(titleSvg && "sr-only")}>
            {renderTitle ? (
              renderTitle(event.title)
            ) : (
              <h1 className={EVENT_DETAILS_LAYOUT.title}>{event.title}</h1>
            )}
          </div>
          <AddedAt value={event.added_at} timeZone={getSchoolTimezone(event.school)} />
        </Stack>

        <Stack gap={6} className="order-3" data-skeleton-key="event-facts">
          <FormGrid columns={2} collapse={false}>
            <EventDateCell event={event} />
            <EventLocationCell event={event} />
            <EventFoodCell event={event} />
            <EventCostCell event={event} />
            <EventRegistrationCell event={event} />
          </FormGrid>

          <EventAdmissionCard event={event} school={school} />
        </Stack>

        <Stack gap={6} className="order-4" data-skeleton-key="event-about">
          <EventAboutSection event={event} isFetchingDetails={isFetchingDetails} />

          <EventSourceSection event={event} />

          <EventMapSection event={event} school={school} />
        </Stack>
      </div>

      <Stack gap={6} className={EVENT_DETAILS_LAYOUT.sidebar} data-skeleton-key="event-host">
        <Section variant="divided" title={t("events.hostedBy")} data-slot="event-host">
            <ClubBadgeLink
              clubId={event.club_id}
              clubName={event.club}
              clubLogoUrl={event.club_logo_url}
              cohosts={event.cohosts}
              clubType={event.club_type}
              school={event.school}
              verified={event.verified}
              onNavigate={onClubNavigate}
            />
        </Section>

        <EventAttendeesSection eventId={event.id} />
      </Stack>
    </div>
  );
}

/** Number of other events "More events" suggests. */
const SIMILAR_EVENT_COUNT = 4;

/**
 * "More events" while the school's feed loads. It holds the section's place,
 * so the cards fill it in rather than appearing below a page that then grows.
 */
export function EventDetailsSimilarEventsSkeleton({ ref }: { ref?: Ref<HTMLElement> }) {
  const { t } = useTranslation();
  return (
    <>
      <Separator />
      <Section ref={ref} title={t("events.moreEvents")} aria-busy="true">
        <div className={CARD_GRID_CLASS}>
          {Array.from({ length: SIMILAR_EVENT_COUNT }, (_, index) => <EventCardSkeleton key={index} />)}
        </div>
      </Section>
    </>
  );
}

export function EventDetailsSimilarEvents({
  event,
  events,
  onEventClick,
}: {
  event: Event;
  events: Event[];
  onEventClick: (event: Event) => void;
}) {
  const { t } = useTranslation();
  const { data: eventStatsData, isSuccess: eventStatsReady } = useEventStats(
    event.school,
  );
  const eventStats = eventStatsReady ? (eventStatsData ?? {}) : null;
  const currentTimeMs = useCurrentTime();
  const similarEvents = useMemo(() => {
    const seed = event.id;
    return events
      .filter(
        (candidate) =>
          candidate.id !== event.id &&
          (currentTimeMs === null ||
            hasActiveEventOccurrence(candidate, currentTimeMs)),
      )
      .toSorted((a, b) => {
        const hashA = ((seed * a.id) % 1000) / 1000;
        const hashB = ((seed * b.id) % 1000) / 1000;
        return hashA - hashB;
      })
      .slice(0, SIMILAR_EVENT_COUNT);
  }, [currentTimeMs, event.id, events]);

  if (similarEvents.length === 0) {
    return null;
  }

  return (
    <>
      <Separator />
      <Section title={t("events.moreEvents")}>
        {/* More events use the same shared card grid as the main feed. */}
        <div className={CARD_GRID_CLASS}>
          {similarEvents.map((similarEvent) => (
            <EventCard
              key={similarEvent.id}
              event={similarEvent}
              stats={eventStats?.[String(similarEvent.id)]}
              onEventClick={onEventClick}
            />
          ))}
        </div>
      </Section>
    </>
  );
}
