import { useTranslation } from "react-i18next";
import { CalendarDays } from "lucide-react";
import { eventPagePath } from "@/features/events/lib/eventUrls";
import type { ApiFollowedAccountEventResponse } from "@/shared/generated";
import { getCurrentSchool, schoolPageHref } from "@/shared/constants/schools";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemLink, ItemMedia, ItemTitle } from "@/shared/ui/item";
import { ImageTile } from "@/shared/ui/tile";
import { formatRelativeTimeCompact } from "@/shared/utils/relativeTime";

interface FollowedAccountEventsProps {
  events: ApiFollowedAccountEventResponse[];
  getSchoolName: (school: string) => string;
}

/** The events automated follows brought in: each opens its event page on its school's site. */
export function FollowedAccountEvents({ events, getSchoolName }: FollowedAccountEventsProps) {
  const { t } = useTranslation();
  const currentSchool = getCurrentSchool();

  return (
    <ItemGroup>
      {events.map((event) => (
        <Item key={event.id} size="sm">
          <ItemMedia>
            <ImageTile src={event.image_url ?? null} kind="poster" fallback={<CalendarDays className="size-4" />} />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>
              <ItemLink asChild>
                <a href={schoolPageHref(event.school, eventPagePath(event.id), currentSchool)} target="_blank" rel="noopener noreferrer">
                  {event.title}
                </a>
              </ItemLink>
            </ItemTitle>
            <ItemDescription>
              {[
                `@${event.handle}`,
                getSchoolName(event.school),
                event.added_at ? t("admin.automatedFollows.eventAdded", { time: formatRelativeTimeCompact(event.added_at, t) }) : null,
                t("admin.automatedFollows.followedAt", { time: formatRelativeTimeCompact(event.followed_at, t) }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </ItemDescription>
          </ItemContent>
        </Item>
      ))}
    </ItemGroup>
  );
}
