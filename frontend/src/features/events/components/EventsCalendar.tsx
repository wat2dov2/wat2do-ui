import { useMemo, useState } from "react";
import { Calendar, dateFnsLocalizer, type ToolbarProps, type View, type Formats } from "react-big-calendar";
import { format, getDay, startOfWeek } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import { fr } from "date-fns/locale/fr";
import { toZonedTime } from "date-fns-tz";
import { useTranslation } from "react-i18next";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "./events-calendar.css";
import { toCalendarEvents, type CalendarEvent } from "@/features/events/lib/calendarEvents";
import { EventViewSurface } from "@/features/events/components/EventViewSurface";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { controlBox } from "@/shared/config/controlBox";
import { Stack } from "@/shared/layout/stack";
import { Button } from "@/shared/ui/button";
import { ChevronLeft, ChevronRight } from "@/shared/ui/doodle-icons";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import type { Event } from "@/shared/types";

const localizer = dateFnsLocalizer({ format, startOfWeek, getDay, locales: { en: enUS, fr } });

function CalendarToolbar({ label, onNavigate, onView, view }: ToolbarProps<CalendarEvent>) {
  const { t } = useTranslation();
  return (
    <Stack direction="horizontal" align="center" justify="between" wrap gap={2}>
      <Stack direction="horizontal" align="center" gap={2}>
        <Button variant="ghost" size="icon-sm" aria-label={t("events.views.previous")} onClick={() => onNavigate("PREV")}><ChevronLeft /></Button>
        <span className="font-semibold">{label}</span>
        <Button variant="ghost" size="icon-sm" aria-label={t("events.views.next")} onClick={() => onNavigate("NEXT")}><ChevronRight /></Button>
        <Button variant="outline" size="sm" onClick={() => onNavigate("TODAY")}>{t("filters.today")}</Button>
      </Stack>
      <Tabs value={view} onValueChange={next => onView(next as View)}>
        <TabsList>
          <TabsTrigger value="month">{t("events.views.month")}</TabsTrigger>
          <TabsTrigger value="week">{t("events.views.week")}</TabsTrigger>
          <TabsTrigger value="day">{t("events.views.day")}</TabsTrigger>
        </TabsList>
      </Tabs>
    </Stack>
  );
}

export function EventsCalendar({ events, school, onEventClick }: { events: Event[]; school: string; onEventClick: (event: Event) => void }) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const timeZone = getSchoolTimezone(school);
  const [date, setDate] = useState(() => toZonedTime(new Date(), timeZone));
  const [view, setView] = useState<View>("day");
  const occurrences = useMemo(() => toCalendarEvents(events, timeZone), [events, timeZone]);
  const formats = useMemo<Formats>(() => {
    const dateLabel = (date: Date, options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(i18n.language, options).format(date);
    const timeLabel = (date: Date) => dateLabel(date, { hour: "numeric", minute: "2-digit" });
    return {
      dateFormat: date => dateLabel(date, { day: "numeric" }),
      dayFormat: date => dateLabel(date, { weekday: "short", day: "numeric" }),
      weekdayFormat: date => dateLabel(date, { weekday: "short" }),
      monthHeaderFormat: date => dateLabel(date, { month: "short", year: "numeric" }),
      dayHeaderFormat: date => dateLabel(date, { weekday: "short", month: "short", day: "numeric" }),
      dayRangeHeaderFormat: ({ start, end }) => `${dateLabel(start, { month: "short", day: "numeric" })} - ${dateLabel(end, { month: "short", day: "numeric" })}`,
      timeGutterFormat: timeLabel,
      eventTimeRangeFormat: ({ start, end }) => `${timeLabel(start)} - ${timeLabel(end)}`,
      eventTimeRangeStartFormat: ({ start }) => timeLabel(start),
      eventTimeRangeEndFormat: ({ end }) => timeLabel(end),
    };
  }, [i18n.language]);
  const scrollToTime = useMemo(() => {
    const time = new Date(date);
    time.setHours(controlBox.eventDiscovery.views.calendar_scroll_hour, 0, 0, 0);
    return time;
  }, [date]);

  return (
    <EventViewSurface aria-label={t("events.views.calendar")}>
      <div className="events-calendar">
        <Calendar<CalendarEvent>
          localizer={localizer}
          culture={i18n.language.startsWith("fr") ? "fr" : "en"}
          events={occurrences}
          date={date}
          view={view}
          views={["month", "week", "day"]}
          onNavigate={setDate}
          onView={setView}
          onSelectEvent={item => onEventClick(item.event)}
          getNow={() => toZonedTime(new Date(), timeZone)}
          scrollToTime={scrollToTime}
          startAccessor="start"
          endAccessor="end"
          components={{ toolbar: CalendarToolbar }}
          formats={formats}
          messages={{
            today: t("filters.today"), previous: t("events.views.previous"), next: t("events.views.next"),
            month: t("events.views.month"), week: t("events.views.week"), day: t("events.views.day"),
            allDay: t("events.views.allDay"), showMore: count => t("events.views.more", { count }),
          }}
          popup
        />
      </div>
    </EventViewSurface>
  );
}
