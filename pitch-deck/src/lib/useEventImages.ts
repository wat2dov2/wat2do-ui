import { useEffect, useState } from "react";
import { fetchEventImages } from "./events";
import type { EventImage } from "./types";

export function useEventImages(limit = 48) {
  const [events, setEvents] = useState<EventImage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchEventImages(limit)
      .then((events) => {
        if (!alive) return;
        setEvents(events);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [limit]);

  return { events, loading };
}
