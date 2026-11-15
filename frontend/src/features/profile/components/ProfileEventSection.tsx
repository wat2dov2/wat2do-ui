import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { Ticket } from "lucide-react";
import { eventPagePath } from "@/features/events";
import type { ProfileEventRow } from "@/features/profile/hooks/useProfileEvents";
import { ticketPath } from "@/shared/constants/routes";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Section, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/shared/ui/item";
import { Skeleton } from "@/shared/ui/skeleton";
import { formatOccurrence } from "@/shared/utils/date";

function ProfileEventItem({ row }: { row: ProfileEventRow }) {
  const { t, i18n } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const when = formatOccurrence(
    { dtstart_utc: row.dtstartUtc, dtend_utc: row.dtendUtc },
    getSchoolTimezone(row.school),
    i18n.language,
  );
  return (
    <Item variant="outline" size="sm">
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
  /** What the section says while it holds nothing. */
  empty: string;
  rows: ProfileEventRow[];
  isPending: boolean;
}

/** One of the profile's event lists: each event on its date, linked to its page. */
export function ProfileEventSection({ title, empty, rows, isPending }: ProfileEventSectionProps) {
  return (
    <Section title={title} description={!isPending && rows.length === 0 ? empty : undefined}>
      {isPending ? (
        <ProfileRowsSkeleton />
      ) : rows.length ? (
        <Stack gap={2}>
          {rows.map((row) => (
            <ProfileEventItem key={row.key} row={row} />
          ))}
        </Stack>
      ) : null}
    </Section>
  );
}

/** Two rows' worth of space while a profile list loads. */
export function ProfileRowsSkeleton() {
  return (
    <Stack gap={2} aria-hidden="true">
      <Skeleton className="h-16 w-full rounded-md" />
      <Skeleton className="h-16 w-full rounded-md" />
    </Stack>
  );
}
