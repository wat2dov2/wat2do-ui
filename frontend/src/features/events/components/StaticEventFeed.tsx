import { EventCardContent } from "@/shared/ui/event-card-content";
import { CARD_GRID_CLASS, EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";
import { getEventCardWaterpaintStyle } from "@/shared/utils/eventCardWaterpaint";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { formatRelativeTime } from "@/shared/utils/relativeTime";
import { getCategoryClasses, getEventCategory } from "@/shared/utils/event";
import { getSchoolDisplayName } from "@/shared/constants/schools";
import commonLocale from "@/shared/locales/en.json";
import eventsLocale from "@/features/events/locales/en.json";
import type { PaginatedEventsResponse } from "@/features/events/api/events.api";
import type { Event } from "@/shared/types";

interface StaticEventFeedProps {
  feed: PaginatedEventsResponse;
  school: string;
}

const copy = {
  brand: "Wat2Do",
  logoAlt: `${commonLocale.common.logo}`,
  navigationEvents: commonLocale.navigation.events,
  upcoming: eventsLocale.events.upcoming,
  noEventsScheduled: eventsLocale.events.noEventsScheduled,
  noEventsScheduledDesc: eventsLocale.events.noEventsScheduledDesc,
  latestAddedEvent: eventsLocale.events.latestAddedEvent,
  free: commonLocale.common.free,
  freeFood: commonLocale.common.freeFood,
  registration: commonLocale.common.registrationRequired,
  eventCount(count: number) {
    const unit =
      count === 1
        ? eventsLocale.events.upcomingEventCount
        : eventsLocale.events.upcomingEventCount_other;
    return `${count.toLocaleString()} ${unit}`;
  },
  eventsListAria(count: number) {
    return `${count.toLocaleString()} ${commonLocale.common.events}`;
  },
  clickCount(count: number) {
    const template =
      count === 1 ? eventsLocale.events.clickCount : eventsLocale.events.clickCount_other;
    return template.replace("{{count}}", count.toLocaleString());
  },
};

function translateRelativeTime(key: string, opts?: Record<string, unknown>): string {
  const count = typeof opts?.count === "number" ? opts.count : null;
  const common = commonLocale.common as Record<string, string>;
  const resolvedKey = count !== null && count !== 1 ? `${key}_other` : key;
  const template = common[resolvedKey.replace("common.", "")] ?? common[key.replace("common.", "")] ?? key;
  return count === null ? template : template.replace("{{count}}", count.toLocaleString());
}

function getLatestAddedText(feed: PaginatedEventsResponse): string | null {
  if (!feed.latest_added_event) return null;
  return copy.latestAddedEvent
    .replace("{{title}}", feed.latest_added_event.title)
    .replace(
      "{{time}}",
      formatRelativeTime(feed.latest_added_event.added_at, translateRelativeTime),
    );
}

function getStaticBadges(event: Event): Array<{ text: string }> {
  const badges: Array<{ text: string }> = [];
  if (event.price === 0) badges.push({ text: copy.free });
  if ((event.food ?? []).length > 0) badges.push({ text: copy.freeFood });
  if (event.registration) badges.push({ text: copy.registration });
  return badges;
}

function StaticEventCard({ event, index }: { event: Event; index: number }) {
  const eventCategory = getEventCategory(event);
  const categoryClasses = getCategoryClasses(eventCategory);
  const cardDate = formatCardDate(event);
  const cardTime = formatCardTime(event);

  return (
    <article className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl bg-card">
      <div className="relative overflow-hidden" style={{ height: EVENT_CARD_IMAGE_HEIGHT }}>
        {event.source_image_url ? (
          <img
            src={event.source_image_url}
            alt={event.title}
            loading={index < 6 ? "eager" : "lazy"}
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div
            className={`absolute inset-0 ${categoryClasses.bg}`}
            aria-hidden="true"
          />
        )}
        <div className="absolute left-2 top-2 rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-bold text-foreground">
          {eventCategory}
        </div>
        {event.organization ? (
          <div className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-bold text-foreground">
            <span className="block truncate">{event.organization}</span>
          </div>
        ) : null}
      </div>
      <div
        className={`event-card-waterpaint flex flex-1 flex-col overflow-hidden rounded-b-xl border-x border-b ${categoryClasses.bg} ${categoryClasses.text} ${categoryClasses.border}`}
        style={getEventCardWaterpaintStyle(event.id)}
      >
        <EventCardContent
          title={event.title}
          date={cardDate}
          time={cardTime}
          location={event.location ?? undefined}
          badges={getStaticBadges(event)}
          clickLabel={copy.clickCount(event.click_count ?? 0)}
          textClassName={categoryClasses.text}
          secondaryTextClassName={categoryClasses.text}
          badgeClassName={`border-current ${categoryClasses.text}`}
        />
      </div>
    </article>
  );
}

export function StaticEventFeed({ feed, school }: StaticEventFeedProps) {
  const latestAddedText = getLatestAddedText(feed);
  const schoolName = getSchoolDisplayName(school);

  return (
    <div id="server-event-feed" className="min-h-dvh bg-background text-foreground">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-border/70 bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-3 sm:px-4 lg:px-6">
          <a href="/" aria-label={copy.navigationEvents} className="flex min-w-0 items-center gap-2">
            <img src="/wat2do-logo.svg" alt={copy.logoAlt} className="size-8 shrink-0" />
            <span className="truncate text-lg font-semibold text-foreground">{copy.brand}</span>
          </a>
          <span className="max-w-[50vw] truncate text-sm text-muted-foreground">{schoolName}</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-3 pb-24 pt-20 sm:px-4 lg:px-6">
        <section className="space-y-3 pb-4" aria-label={copy.navigationEvents}>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
              {copy.eventCount(feed.total)}
            </h1>
            {latestAddedText ? (
              <p className="mt-1 truncate text-sm text-muted-foreground">{latestAddedText}</p>
            ) : null}
          </div>
        </section>

        {feed.items.length > 0 ? (
          <section className="space-y-2.5" aria-label={copy.upcoming}>
            <h2 className="text-base font-normal tracking-normal text-foreground">
              {copy.upcoming}
            </h2>
            <div className={CARD_GRID_CLASS} role="list" aria-label={copy.eventsListAria(feed.total)}>
              {feed.items.map((event, index) => (
                <div key={event.id} role="listitem" className="min-w-0">
                  <StaticEventCard event={event} index={index} />
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section className="flex flex-col items-center justify-center px-4 py-24">
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              {copy.noEventsScheduled}
            </h2>
            <p className="max-w-md text-center text-sm text-muted-foreground">
              {copy.noEventsScheduledDesc}
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
