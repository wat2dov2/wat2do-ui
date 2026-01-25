import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Calendar,
  MapPin,
  Clock,
  Heart,
  ChevronDown,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Event } from "@/types";

interface MyEventsViewProps {
  profileCompleted: boolean;
  onSignIn: () => void;
  events: Event[];
  savedEventIds: number[];
  onToggleSave: (eventId: number) => void;
}

type TabType = "upcoming" | "past";

function formatTime(timeStr: string): string {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const h = hours % 12 || 12;
  const ampm = hours >= 12 ? "PM" : "AM";
  return `${h}:${minutes?.toString().padStart(2, "0") || "00"} ${ampm}`;
}

// Group events by time period
function groupEventsByPeriod(events: { event: Event; eventDate: Date }[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const endOfWeek = new Date(today);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  const groups: {
    happeningSoon: typeof events;
    thisWeek: typeof events;
    later: typeof events;
  } = {
    happeningSoon: [],
    thisWeek: [],
    later: [],
  };

  events.forEach((item) => {
    const eventDay = new Date(item.eventDate);
    eventDay.setHours(0, 0, 0, 0);

    if (eventDay.getTime() <= tomorrow.getTime()) {
      groups.happeningSoon.push(item);
    } else if (eventDay.getTime() <= endOfWeek.getTime()) {
      groups.thisWeek.push(item);
    } else {
      groups.later.push(item);
    }
  });

  return groups;
}

export function MyEventsView({
  profileCompleted,
  onSignIn,
  events,
  savedEventIds,
  onToggleSave,
}: MyEventsViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>("upcoming");
  const [showPastEvents, setShowPastEvents] = useState(false);

  // Get user's saved events
  const userEvents = useMemo(() => {
    return savedEventIds
      .map((id) => {
        const event = events.find((e) => e.id === id);
        if (!event) return null;

        const eventDate = parseEventDate(event.date, event.time);

        return { event, eventDate };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime());
  }, [events, savedEventIds]);

  // Split into upcoming and past
  const now = new Date();
  const upcomingEvents = userEvents.filter((item) => item.eventDate >= now);
  const pastEvents = userEvents.filter((item) => item.eventDate < now);

  // Group upcoming events by period
  const groupedUpcoming = useMemo(() => groupEventsByPeriod(upcomingEvents), [upcomingEvents]);

  if (!profileCompleted) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Heart className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">{t("events.signInToView")}</h2>
        <p className="text-muted-foreground text-sm mb-6 max-w-sm">
          {t("events.signInToViewDesc")}
        </p>
        <Button onClick={onSignIn}>{t("events.signIn")}</Button>
      </div>
    );
  }

  const hasNoEvents = savedEventIds.length === 0;

  if (hasNoEvents) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Heart className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">No saved events yet</h2>
        <p className="text-muted-foreground text-sm mb-6 max-w-sm">
          {t("events.emptyEventsDesc")}
        </p>
        <Button onClick={() => window.history.back()}>{t("events.discoverEvents")}</Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground mb-1">My Events</h1>
        <p className="text-sm text-muted-foreground">
          {savedEventIds.length} saved
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-muted p-1 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab("upcoming")}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
            activeTab === "upcoming"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("events.upcoming")}
          {upcomingEvents.length > 0 && (
            <span className="ml-2 text-xs bg-primary/20 dark:bg-primary/40 text-primary px-1.5 py-0.5 rounded-full">
              {upcomingEvents.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("past")}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
            activeTab === "past"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Past
          {pastEvents.length > 0 && (
            <span className="ml-2 text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
              {pastEvents.length}
            </span>
          )}
        </button>
      </div>

      {activeTab === "upcoming" ? (
        <>
          {upcomingEvents.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground text-sm">{t("events.noUpcomingEvents")}</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Happening Soon */}
              {groupedUpcoming.happeningSoon.length > 0 && (
                <EventGroup
                  title="Happening Soon"
                  events={groupedUpcoming.happeningSoon}
                  onToggleSave={onToggleSave}
                />
              )}

              {/* This Week */}
              {groupedUpcoming.thisWeek.length > 0 && (
                <EventGroup
                  title={t("events.thisWeek")}
                  events={groupedUpcoming.thisWeek}
                  onToggleSave={onToggleSave}
                />
              )}

              {/* Later */}
              {groupedUpcoming.later.length > 0 && (
                <EventGroup
                  title={t("common.later")}
                  events={groupedUpcoming.later}
                  onToggleSave={onToggleSave}
                />
              )}
            </div>
          )}
        </>
      ) : (
        <>
          {pastEvents.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground text-sm">No past events</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pastEvents.map((item) => (
                <EventTimelineItem
                  key={item.event.id}
                  event={item.event}
                  eventDate={item.eventDate}
                  onToggleSave={onToggleSave}
                  isPast
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Event Group Component
function EventGroup({
  title,
  events,
  onToggleSave,
}: {
  title: string;
  events: { event: Event; eventDate: Date }[];
  onToggleSave: (eventId: number) => void;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        {title}
      </h3>
      <div className="space-y-3">
        {events.map((item) => (
          <EventTimelineItem
            key={item.event.id}
            event={item.event}
            eventDate={item.eventDate}
            onToggleSave={onToggleSave}
          />
        ))}
      </div>
    </div>
  );
}

// Event Timeline Item Component
function EventTimelineItem({
  event,
  eventDate,
  onToggleSave,
  isPast = false,
}: {
  event: Event;
  eventDate: Date;
  onToggleSave: (eventId: number) => void;
  isPast?: boolean;
}) {
  return (
    <div
      className={`bg-card border rounded-lg p-4 transition-all hover:shadow-sm ${
        isPast ? "opacity-60 border-border" : "border-border hover:border-gray-300 dark:hover:border-gray-600"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Status Indicator */}
        <div className="mt-1 flex-shrink-0">
            <div className="w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600" />
        </div>

        {/* Event Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h4 className="font-semibold text-foreground text-sm truncate">
                {event.title}
              </h4>
              <p className="text-xs text-muted-foreground truncate">{event.organization}</p>
            </div>
            <div className="flex-shrink-0 text-right">
              <p className="text-sm font-medium text-foreground">
                {formatTime(event.time)}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatEventDate(eventDate)}
              </p>
            </div>
          </div>

          {/* Location */}
          <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
            <MapPin className="w-3.5 h-3.5" />
            <span>{event.location}</span>
              <span className="ml-2 px-1.5 py-0.5 bg-muted text-muted-foreground rounded text-[10px] font-medium">
                Saved
              </span>
          </div>

          {/* Actions */}
          {!isPast && (
            <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={() => onToggleSave(event.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-error transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    Remove
                  </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default MyEventsView;
