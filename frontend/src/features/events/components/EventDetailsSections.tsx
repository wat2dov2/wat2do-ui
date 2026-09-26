import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { useEventView } from "@/features/events/hooks/useEventStats";
import publicAttendance from "../../../../../backend/controlbox/public_attendance.json";
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
import {
  Calendar,
  DollarSign,
  Edit,
  Flag,
  LocationPin,
  Share2,
  Trash2,
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
import { FormGrid, Section, Stack } from "@/shared/layout";
import { CARD_GRID_CLASS } from "@/shared/constants/ui";
import { EventCalendarDownloadMenu } from "@/features/events/components/EventCalendarDownloadMenu";
import { EventCard } from "@/features/events/components/EventCard";
import { EventCardImage } from "@/features/events/components/EventCardImage";
import { EventLocationMap } from "@/features/events/components/EventLocationMap";
import { ClubBadgeDropdown } from "@/features/clubs";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { GoingOccurrencePickerContent } from "@/features/events/components/GoingOccurrencePickerContent";
import { fetchEventAttendees } from "@/features/events/api/events.api";
import { deleteEventAPI } from "@/features/events/api/events.api";
import { useEventStats } from "@/features/events/hooks/useEventStats";
import { useCurrentTime, useGoingEventSelection } from "@/features/events/hooks/useGoingEvents";
import { EmailOtpForm } from "@/features/auth/components/EmailOtpForm";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { useUIStore } from "@/shared/store/ui.store";
import { controlBox } from "@/shared/config/controlBox";
import { translateFood } from "@/shared/utils/foodTranslation";
import { queryKeys } from "@/shared/lib/queryKeys";
import { ROUTES } from "@/shared/constants/routes";
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

function EventDateTile({
  dtstartUtc,
  locale,
  timeZone,
}: {
  dtstartUtc: string;
  locale: string;
  timeZone: string;
}) {
  const start = new Date(dtstartUtc);
  if (Number.isNaN(start.getTime())) return null;
  return (
    <Card className="size-10 shrink-0 items-center justify-center gap-0.5 py-0">
      <span className="text-[9px] font-semibold">
        {start.toLocaleDateString(locale, { month: "short", timeZone })}
      </span>
      <span className="text-base font-bold leading-none">{start.toLocaleDateString(locale, { day: "numeric", timeZone })}</span>
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
      <EventDateTile
        dtstartUtc={primaryOccurrence.dtstart_utc}
        locale={locale}
        timeZone={timeZone}
      />
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
  const { getSchoolTimezone } = useSchoolDirectory();
  const now = useCurrentTime();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const isGoingActive = profileCompleted && going.isActive;
  const displayName = userFullName || userEmail?.split("@")[0] || "";

  const nextSelectedOccurrence = going.selectableOccurrences.find((occurrence) =>
    going.selectedSelectableIds.includes(occurrence.id),
  );
  const countdown =
    now !== null && nextSelectedOccurrence
      ? formatCountdown(new Date(nextSelectedOccurrence.dtstart_utc).getTime(), now)
      : null;

  const startRegistration = async () => {
    if (going.selectableOccurrences.length > 1) {
      setPickerOpen(true);
      return;
    }

    const occurrence = going.selectableOccurrences[0];
    if (!occurrence) {
      return;
    }

    try {
      await going.saveSelection([occurrence.id]);
    } catch {
      // The going-events hook owns the user-facing failure toast.
    }
  };

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
              <Button type="button" variant="outline" onClick={() => setShareOpen(true)}>
                <Share2 className="size-4" />
                {t("common.share")}
              </Button>
            </Stack>
            <CardDescription>
              {t("events.cancelGoingPrompt")}{" "}
              <Button
                type="button"
                variant="link"
                size="inline"
                disabled={going.isPending}
                onClick={() => void going.saveSelection([])}
              >
                {t("events.cancelGoing")}
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
      <CardContent>
        {pickerOpen ? (
          <GoingOccurrencePickerContent
            timeZone={getSchoolTimezone(event.school)}
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
            ) : (
              <EmailOtpForm
                data-testid="event-registration-auth"
                school={event.school ?? school}
                requestCodeLabel={t("events.going")}
                actionLabel={t("events.going")}
                focusOnMount={false}
                isSubmitDisabled={
                  going.selectableOccurrences.length === 0
                }
                onAuthenticated={startRegistration}
              />
            )}
          </Stack>
        )}
      </CardContent>
      {!pickerOpen && profileCompleted ? (
        <CardFooter className="w-full">
          <Button
            type="button"
            variant="primary"
            className="w-full"
            disabled={going.isPending || going.selectableOccurrences.length === 0}
            onClick={() => void startRegistration()}
            aria-label={t("events.going")}
            title={t("events.going")}
          >
            {t("events.going")}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

/** "About Event" heading, divider, description, and source link when present. */
function EventAboutSection({
  event,
  isFetchingDetails,
}: {
  event: Event;
  isFetchingDetails: boolean;
}) {
  const { t } = useTranslation();
  const sourceHref = event.source_url ? sanitizeHref(event.source_url) : undefined;
  return (
    <Stack gap={3}>
      <EventSectionHeader>{t("events.aboutEvent")}</EventSectionHeader>
      <p className="whitespace-pre-line text-sm text-muted-foreground">
        {event.description ||
          t(isFetchingDetails ? "events.fetchingDetails" : "common.noDescription")}
      </p>
      {sourceHref && (
        <a
          href={sourceHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit max-w-full items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <span className="shrink-0">{t("events.sourceLabel")}</span>
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

/** Shared live attendance summary for the drawer and event page. */
function EventAttendeesSection({ eventId }: { eventId: number }) {
  const { t } = useTranslation();
  const { data: attendees } = useQuery({
    queryKey: queryKeys.events.attendees(eventId),
    queryFn: () => fetchEventAttendees(eventId),
    staleTime: controlBox.clientCache.liveEventDataStaleMs,
  });
  if (!attendees || attendees.going_count <= 0) return null;

  const profiles = attendees.attendees.slice(0, publicAttendance.maximum_display_names);
  const overflowCount = profiles.length === publicAttendance.maximum_display_names
    ? Math.max(0, attendees.going_count - profiles.length)
    : 0;
  return (
    <Stack gap={3}>
      <EventSectionHeader>
        {t("events.goingCount", { count: attendees.going_count })}
      </EventSectionHeader>
      <AvatarStack
        avatars={profiles.map((attendee) => ({
          name: attendee.name || t("events.going"),
          src: attendee.avatar_url,
        }))}
        overflowCount={overflowCount}
        overflowLabel={t("events.andOthersCount", { count: overflowCount })}
      />
    </Stack>
  );
}

/** Share and report actions, owning their own dialogs. */
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
  const { isAdmin } = useAuthState();
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
        router.replace(ROUTES.HOME);
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
      {isAdmin && (
        <>
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
        </>
      )}
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
      {isAdmin && deleteOpen && (
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
 * Mobile stacking order: poster, title, hosts/going, then event details.
 */
export function EventDetailsBody({
  event,
  school,
  isFetchingDetails = false,
  renderTitle,
  onClubFilterSelect,
}: {
  event: Event;
  school: string | null | undefined;
  isFetchingDetails?: boolean;
  /** Override the title element (the drawer supplies its DrawerTitle). */
  renderTitle?: (title: string) => React.ReactNode;
  /** Lets drawer composition close after its club filter is applied. */
  onClubFilterSelect?: () => void;
}) {
  useEventView(event.id, event.school);
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[320px_minmax(0,1fr)] md:grid-rows-[auto_1fr] md:items-start md:gap-x-8">
      <div
        className="mx-auto w-full max-w-sm select-none md:col-start-1 md:mx-0"
        onDragStart={(dragEvent) => dragEvent.preventDefault()}
      >
        <EventCardImage
          event={event}
          variant="detail"
          onClubFilterSelect={onClubFilterSelect}
        />
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
        </Stack>

        <Stack gap={6} className="order-4">
          <EventAboutSection event={event} isFetchingDetails={isFetchingDetails} />

          <EventMapSection event={event} school={school} />
        </Stack>
      </div>

      <Stack gap={6} className="order-2 md:col-start-1">
        <Stack gap={3} data-slot="event-host">
          <EventSectionHeader>{t("events.hostedBy")}</EventSectionHeader>
            <ClubBadgeDropdown
              clubName={event.club}
              clubLogoUrl={event.club_logo_url}
              clubType={event.club_type}
              school={event.school}
              clubPage={event.club_page}
              clubIg={event.club_ig}
              clubDiscord={event.club_discord}
              onFilterSelect={onClubFilterSelect}
            />
        </Stack>

        <EventAttendeesSection eventId={event.id} />
      </Stack>
    </div>
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
      .slice(0, 4);
  }, [currentTimeMs, event.id, events]);

  if (similarEvents.length === 0) {
    return null;
  }

  return (
    <>
      <Separator />
      <Section title={t("events.similarEvents")}>
        {/* Similar events use the same shared card grid as the main feed. */}
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
