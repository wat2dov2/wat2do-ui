import React, { useState, useMemo } from "react";
import {
  Calendar,
  MapPin,
  Clock,
  Heart,
  Check,
  ChevronRight,
  ChevronDown,
  Download,
  Navigation,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Event } from "@/types";

interface MyEventsViewProps {
  profileCompleted: boolean;
  onSignIn: () => void;
  events: Event[];
  savedEventIds: number[];
  registeredEventIds: number[];
  onToggleSave: (eventId: number) => void;
  onToggleRegister: (eventId: number) => void;
}

type TabType = "upcoming" | "past";

// Helper to parse event date string into Date object
function parseEventDate(dateStr: string, timeStr: string): Date {
  // Handle relative dates
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (dateStr === "Today") {
    const [hours, minutes] = timeStr.split(":").map(Number);
    const date = new Date(today);
    date.setHours(hours || 12, minutes || 0);
    return date;
  }

  if (dateStr === "Tomorrow") {
    const [hours, minutes] = timeStr.split(":").map(Number);
    const date = new Date(today);
    date.setDate(date.getDate() + 1);
    date.setHours(hours || 12, minutes || 0);
    return date;
  }

  // Try to parse as date string (e.g., "Dec 15" or "December 15, 2024")
  const parsed = new Date(dateStr + " " + timeStr);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  // Default to today if can't parse
  return today;
}

// Helper to format date for display
function formatEventDate(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const eventDay = new Date(date);
  eventDay.setHours(0, 0, 0, 0);

  if (eventDay.getTime() === today.getTime()) {
    return "Today";
  }

  if (eventDay.getTime() === tomorrow.getTime()) {
    return "Tomorrow";
  }

  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTime(timeStr: string): string {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const h = hours % 12 || 12;
  const ampm = hours >= 12 ? "PM" : "AM";
  return `${h}:${minutes?.toString().padStart(2, "0") || "00"} ${ampm}`;
}

// Group events by time period
function groupEventsByPeriod(events: { event: Event; eventDate: Date; status: "saved" | "registered" }[]) {
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
  registeredEventIds,
  onToggleSave,
  onToggleRegister,
}: MyEventsViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>("upcoming");
  const [showPastEvents, setShowPastEvents] = useState(false);

  // Get user's events (saved or registered)
  const userEvents = useMemo(() => {
    const allUserEventIds = [...new Set([...savedEventIds, ...registeredEventIds])];

    return allUserEventIds
      .map((id) => {
        const event = events.find((e) => e.id === id);
        if (!event) return null;

        const eventDate = parseEventDate(event.date, event.time);
        const status: "saved" | "registered" = registeredEventIds.includes(id) ? "registered" : "saved";

        return { event, eventDate, status };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime());
  }, [events, savedEventIds, registeredEventIds]);

  // Split into upcoming and past
  const now = new Date();
  const upcomingEvents = userEvents.filter((item) => item.eventDate >= now);
  const pastEvents = userEvents.filter((item) => item.eventDate < now);

  // Group upcoming events by period
  const groupedUpcoming = useMemo(() => groupEventsByPeriod(upcomingEvents), [upcomingEvents]);

  if (!profileCompleted) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
          <Heart className="w-8 h-8 text-gray-400 dark:text-gray-500" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Sign in to view your events</h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-6 max-w-sm">
          Save events you're interested in and track your registrations all in one place.
        </p>
        <Button onClick={onSignIn}>Sign In</Button>
      </div>
    );
  }

  const hasNoEvents = savedEventIds.length === 0 && registeredEventIds.length === 0;

  if (hasNoEvents) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
          <Heart className="w-8 h-8 text-gray-400 dark:text-gray-500" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">No saved events yet</h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-6 max-w-sm">
          Save events you're interested in and they'll appear here. Tap the heart icon on any event to save it.
        </p>
        <Button onClick={() => window.history.back()}>Discover Events</Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">My Events</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {registeredEventIds.length} registered · {savedEventIds.length} saved
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab("upcoming")}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
            activeTab === "upcoming"
              ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
          }`}
        >
          Upcoming
          {upcomingEvents.length > 0 && (
            <span className="ml-2 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded-full">
              {upcomingEvents.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("past")}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
            activeTab === "past"
              ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
          }`}
        >
          Past
          {pastEvents.length > 0 && (
            <span className="ml-2 text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded-full">
              {pastEvents.length}
            </span>
          )}
        </button>
      </div>

      {activeTab === "upcoming" ? (
        <>
          {upcomingEvents.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400 text-sm">No upcoming events</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Happening Soon */}
              {groupedUpcoming.happeningSoon.length > 0 && (
                <EventGroup
                  title="Happening Soon"
                  events={groupedUpcoming.happeningSoon}
                  onToggleSave={onToggleSave}
                  onToggleRegister={onToggleRegister}
                />
              )}

              {/* This Week */}
              {groupedUpcoming.thisWeek.length > 0 && (
                <EventGroup
                  title="This Week"
                  events={groupedUpcoming.thisWeek}
                  onToggleSave={onToggleSave}
                  onToggleRegister={onToggleRegister}
                />
              )}

              {/* Later */}
              {groupedUpcoming.later.length > 0 && (
                <EventGroup
                  title="Later"
                  events={groupedUpcoming.later}
                  onToggleSave={onToggleSave}
                  onToggleRegister={onToggleRegister}
                />
              )}
            </div>
          )}
        </>
      ) : (
        <>
          {pastEvents.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400 text-sm">No past events</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pastEvents.map((item) => (
                <EventTimelineItem
                  key={item.event.id}
                  event={item.event}
                  eventDate={item.eventDate}
                  status={item.status}
                  onToggleSave={onToggleSave}
                  onToggleRegister={onToggleRegister}
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
  onToggleRegister,
}: {
  title: string;
  events: { event: Event; eventDate: Date; status: "saved" | "registered" }[];
  onToggleSave: (eventId: number) => void;
  onToggleRegister: (eventId: number) => void;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
        {title}
      </h3>
      <div className="space-y-3">
        {events.map((item) => (
          <EventTimelineItem
            key={item.event.id}
            event={item.event}
            eventDate={item.eventDate}
            status={item.status}
            onToggleSave={onToggleSave}
            onToggleRegister={onToggleRegister}
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
  status,
  onToggleSave,
  onToggleRegister,
  isPast = false,
}: {
  event: Event;
  eventDate: Date;
  status: "saved" | "registered";
  onToggleSave: (eventId: number) => void;
  onToggleRegister: (eventId: number) => void;
  isPast?: boolean;
}) {
  const isRegistered = status === "registered";

  return (
    <div
      className={`bg-white dark:bg-gray-800 border rounded-lg p-4 transition-all hover:shadow-sm ${
        isPast ? "opacity-60 border-gray-200 dark:border-gray-700" : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Status Indicator */}
        <div className="mt-1 flex-shrink-0">
          {isRegistered ? (
            <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
              <Check className="w-3 h-3 text-white" strokeWidth={3} />
            </div>
          ) : (
            <div className="w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600" />
          )}
        </div>

        {/* Event Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h4 className="font-semibold text-gray-900 dark:text-gray-100 text-sm truncate">
                {event.title}
              </h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{event.organization}</p>
            </div>
            <div className="flex-shrink-0 text-right">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {formatTime(event.time)}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {formatEventDate(eventDate)}
              </p>
            </div>
          </div>

          {/* Location */}
          <div className="flex items-center gap-1.5 mt-2 text-xs text-gray-500 dark:text-gray-400">
            <MapPin className="w-3.5 h-3.5" />
            <span>{event.location}</span>
            {isRegistered && (
              <span className="ml-2 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded text-[10px] font-medium">
                Registered
              </span>
            )}
            {!isRegistered && (
              <span className="ml-2 px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded text-[10px] font-medium">
                Saved
              </span>
            )}
          </div>

          {/* Actions */}
          {!isPast && (
            <div className="flex items-center gap-2 mt-3">
              {isRegistered ? (
                <>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                    <Download className="w-3.5 h-3.5" />
                    Add to Calendar
                  </button>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                    <Navigation className="w-3.5 h-3.5" />
                    Directions
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => onToggleRegister(event.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                  >
                    Register
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onToggleSave(event.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    Remove
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default MyEventsView;
