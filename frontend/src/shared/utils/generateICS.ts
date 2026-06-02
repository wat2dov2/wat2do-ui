import type { Event } from "@/shared/types";
import { getPrimaryOccurrence } from "@/shared/utils/date";

function toICSDate(isoString: string): string {
  return isoString.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeICS(text: string): string {
  return text.replace(/[\\;,]/g, "\\$&").replace(/\n/g, "\\n");
}

function toGoogleCalendarDate(isoString: string): string {
  return isoString.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function generateICS(event: Event): string {
  const now = toICSDate(new Date().toISOString());
  const primary = getPrimaryOccurrence(event);
  const dtstart_utc = primary?.dtstart_utc;
  const dtend_utc = primary?.dtend_utc;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//wat2do//EN",
    "BEGIN:VEVENT",
    `UID:event-${event.id}@wat2do`,
    `DTSTAMP:${now}`,
    `SUMMARY:${escapeICS(event.title)}`,
    ...(event.description ? [`DESCRIPTION:${escapeICS(event.description)}`] : []),
    `LOCATION:${escapeICS(event.location)}`,
    ...(dtstart_utc ? [`DTSTART:${toICSDate(dtstart_utc)}`] : []),
    ...(dtend_utc ? [`DTEND:${toICSDate(dtend_utc)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.join("\r\n");
}

export function downloadICS(event: Event): void {
  const icsContent = generateICS(event);
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${event.title.replace(/[^a-zA-Z0-9]/g, "_")}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function buildGoogleCalendarUrl(event: Event): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
  });

  if (event.description) {
    params.set("details", event.description);
  }
  if (event.location) {
    params.set("location", event.location);
  }
  const primary = getPrimaryOccurrence(event);
  const dtstart_utc = primary?.dtstart_utc;
  const dtend_utc = primary?.dtend_utc;
  if (dtstart_utc) {
    const start = toGoogleCalendarDate(dtstart_utc);
    const end = dtend_utc ? toGoogleCalendarDate(dtend_utc) : start;
    params.set("dates", `${start}/${end}`);
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function openGoogleCalendar(event: Event): void {
  window.open(buildGoogleCalendarUrl(event), "_blank", "noopener,noreferrer");
}
