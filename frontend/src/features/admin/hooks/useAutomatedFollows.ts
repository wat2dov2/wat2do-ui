import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAutomatedFollows, getFollowedAccountEvents } from "@/features/admin/api/admin.api";
import { dayWindow, shiftDay, todayValue } from "@/features/admin/lib/automatedFollows";
import { queryKeys } from "@/shared/lib/queryKeys";

const FOLLOW_PAGE_SIZE = 24;
const EVENT_PAGE_SIZE = 50;

/** One day of automated follows and the events their accounts brought in, for one school or all. */
export function useAutomatedFollows() {
  const [school, setSchoolFilter] = useState("");
  const [day, setDayValue] = useState(todayValue);
  const [followPage, setFollowPage] = useState(1);
  const [eventPage, setEventPage] = useState(1);
  const range = dayWindow(day);

  const follows = useQuery({
    queryKey: queryKeys.instagramPublishing.automatedFollowPage(school, day, followPage),
    queryFn: () => getAutomatedFollows({ school, ...range, page: followPage, pageSize: FOLLOW_PAGE_SIZE }),
    placeholderData: (previous) => previous,
  });
  const events = useQuery({
    queryKey: queryKeys.instagramPublishing.followedAccountEventPage(school, day, eventPage),
    queryFn: () => getFollowedAccountEvents({ school, ...range, page: eventPage, pageSize: EVENT_PAGE_SIZE }),
    placeholderData: (previous) => previous,
  });
  const setDay = (value: string) => {
    setDayValue(value);
    setFollowPage(1);
    setEventPage(1);
  };

  return {
    school,
    day,
    isToday: day === todayValue(),
    follows,
    events,
    followPage,
    eventPage,
    setFollowPage,
    setEventPage,
    setDay,
    previousDay: () => setDay(shiftDay(day, -1)),
    nextDay: () => setDay(shiftDay(day, 1)),
    setSchool: (value: string) => {
      setSchoolFilter(value);
      setFollowPage(1);
      setEventPage(1);
    },
  };
}
