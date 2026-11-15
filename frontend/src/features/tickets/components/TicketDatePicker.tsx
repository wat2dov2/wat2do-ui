import { useTranslation } from "react-i18next";
import type { TicketDate } from "@/features/tickets/lib/ticketFormat";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import type { Event } from "@/shared/types";
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
 * Which date a ticket or RSVP is for, asked only when several are open. How
 * many are left for the picked date shows in the Get tickets button instead.
 */
export function TicketDatePicker({ event, dates, selectedDateId, onSelect }: TicketDatePickerProps) {
  const { i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  if (dates.length < 2) return null;
  return (
    <RadioOptionGroup
      name={`ticket-date-${event.id}`}
      value={selectedDateId}
      onChange={onSelect}
      options={dates.map((date) => ({
        value: date.event_date_id,
        label: formatOccurrence(date, getSchoolTimezone(event.school), i18n.language),
      }))}
    />
  );
}
