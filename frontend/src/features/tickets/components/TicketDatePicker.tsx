import { useTranslation } from "react-i18next";
import type { TicketDate } from "@/features/tickets/lib/ticketFormat";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import type { Event } from "@/shared/types";
import { CardDescription } from "@/shared/ui/card";
import { RadioOptionGroup } from "@/shared/ui/radio-option-group";
import { formatOccurrence } from "@/shared/utils/date";

interface TicketDatePickerProps {
  event: Event;
  /** The dates still open to the viewer. */
  dates: TicketDate[];
  selectedDateId: string;
  onSelect: (eventDateId: string) => void;
}

/**
 * Which date a ticket or RSVP is for, asked only when several are open; with one
 * date, just how many spots are left (when the club set a limit).
 */
export function TicketDatePicker({ event, dates, selectedDateId, onSelect }: TicketDatePickerProps) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const remaining = (date: TicketDate | undefined) =>
    date?.remaining == null ? undefined : t("tickets.card.left", { count: date.remaining });
  if (dates.length > 1) {
    return (
      <RadioOptionGroup
        name={`ticket-date-${event.id}`}
        value={selectedDateId}
        onChange={onSelect}
        options={dates.map((date) => ({
          value: date.event_date_id,
          label: formatOccurrence(date, getSchoolTimezone(event.school), i18n.language),
          description: remaining(date),
        }))}
      />
    );
  }
  const left = remaining(dates[0]);
  return left ? <CardDescription>{left}</CardDescription> : null;
}
