import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { Ticket } from "lucide-react";
import { eventPagePath } from "@/features/events";
import { ProfileListSection, ProfileRow, type ProfileListEmpty } from "@/features/profile/components/ProfileListSection";
import type { ProfileEventRow } from "@/features/profile/hooks/useProfileEvents";
import { ticketPath } from "@/shared/constants/routes";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Button } from "@/shared/ui/button";
import { DateLeaf, ImageTile } from "@/shared/ui/tile";
import { formatOccurrence } from "@/shared/utils/date";

/** One event on one of its dates: its poster (a calendar leaf without one), its name, when and where, and the visitor's ticket; the row opens its page. */
function ProfileEventItem({ row }: { row: ProfileEventRow }) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const timeZone = getSchoolTimezone(row.school);
  const when = formatOccurrence({ dtstart_utc: row.dtstartUtc, dtend_utc: row.dtendUtc }, timeZone, i18n.language);
  return (
    <ProfileRow
      media={
        <ImageTile
          src={row.image?.src ?? null}
          kind={row.image?.kind ?? "poster"}
          fallback={<DateLeaf dtstartUtc={row.dtstartUtc} locale={i18n.language} timeZone={timeZone} />}
        />
      }
      title={row.title}
      description={row.location ? `${when} · ${row.location}` : when}
      target={{ href: eventPagePath(row.eventId) }}
      actions={
        row.ticketCode ? (
          <Button asChild variant="outline" size="sm">
            <NextLink href={ticketPath(row.ticketCode)}>
              <Ticket />
              {t("profile.events.ticket")}
            </NextLink>
          </Button>
        ) : undefined
      }
    />
  );
}

interface ProfileEventSectionProps {
  title: string;
  empty: ProfileListEmpty;
  rows: ProfileEventRow[];
  isPending: boolean;
}

/** One of the profile's event lists: each event on its date, opening its page. */
export function ProfileEventSection({ title, empty, rows, isPending }: ProfileEventSectionProps) {
  return (
    <ProfileListSection
      title={title}
      rows={rows}
      isPending={isPending}
      empty={empty}
      rowKey={(row) => row.key}
      renderRow={(row) => <ProfileEventItem row={row} />}
    />
  );
}
