import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { clearNarrowingFilterState, storeStatesToFilterState } from "@/features/search/api/filterService";
import { useSearchStore } from "@/features/search/store/search.store";
import { QP } from "@/shared/constants/queryParams";
import { newlyAddedSince } from "@/shared/utils/date";

/**
 * A link to the new events (`/events?new=1`, where the morning email's
 * notification leads) opens the list with only the newly added filter on.
 * Like any applied filter, it brings the list into view under the filter bar
 * (FilterBar), past the featured row; an ordinary visit keeps its place.
 * The marker then leaves the address, so a reload is an ordinary visit and
 * the same link works again from this page.
 */
export function useNewEventsLink() {
  const opened = useSearchParams().has(QP.NEW_EVENTS);
  useEffect(() => {
    if (!opened) return;
    const store = useSearchStore.getState();
    store.setFilterState({
      ...clearNarrowingFilterState(storeStatesToFilterState(store)),
      addedSince: newlyAddedSince(),
    });
    const url = new URL(window.location.href);
    url.searchParams.delete(QP.NEW_EVENTS);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [opened]);
}
