import type { Event } from "@/shared/types";

function toICSDate(isoString: string): string {
  return isoString.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeICS(text: string): string {
  return text.replace(/[\\;,]/g, "\\$&").replace(/\n/g, "\\n");
}

export function generateICS(event: Event): string {
  const now = toICSDate(new Date().toISOString());
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
    ...(event.dtstart_utc ? [`DTSTART:${toICSDate(event.dtstart_utc)}`] : []),
    ...(event.dtend_utc ? [`DTEND:${toICSDate(event.dtend_utc)}`] : []),
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
