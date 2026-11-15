import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { Ticket } from "lucide-react";
import { eventPagePath } from "@/features/events";
import { ProfileListSection, type ProfileListEmpty } from "@/features/profile/components/ProfileListSection";
import type { ProfileEventRow } from "@/features/profile/hooks/useProfileEvents";
import { ticketPath } from "@/shared/constants/routes";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Button } from "@/shared/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/shared/ui/item";
import { DateLeaf, ImageTile } from "@/shared/ui/tile";
import { formatOccurrence } from "@/shared/utils/date";

/** One event on one of its dates: its poster (a calendar leaf without one), its name linked to its page, when and where, and the visitor's ticket. */
function ProfileEventItem({ row }: { row: ProfileEventRow }) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const timeZone = getSchoolTimezone(row.school);
  const when = formatOccurrence({ dtstart_utc: row.dtstartUtc, dtend_utc: row.dtendUtc }, timeZone, i18n.language);
  return (
    <Item size="sm">
      <ItemMedia>
        <ImageTile
          src={row.image?.src ?? null}
          kind={row.image?.kind ?? "poster"}
          fallback={<DateLeaf dtstartUtc={row.dtstartUtc} locale={i18n.language} timeZone={timeZone} />}
        />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          <NextLink href={eventPagePath(row.eventId)}>{row.title}</NextLink>
        </ItemTitle>
        <ItemDescription>
          {when}
          {row.location ? ` · ${row.location}` : ""}
        </ItemDescription>
      </ItemContent>
      {row.ticketCode ? (
        <ItemActions>
          <Button asChild variant="outline" size="sm">
            <NextLink href={ticketPath(row.ticketCode)}>
              <Ticket />
              {t("profile.events.ticket")}
            </NextLink>
          </Button>
        </ItemActions>
      ) : null}
    </Item>
  );
}

interface ProfileEventSectionProps {
  title: string;
  empty: ProfileListEmpty;
  rows: ProfileEventRow[];
  isPending: boolean;
}

/** One of the profile's event lists: each event on its date, linked to its page. */
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
