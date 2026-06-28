import type { EventImage } from "./types";

const EVENTS_API =
  process.env.NEXT_PUBLIC_EVENTS_API_URL ?? "/api/events/?limit=60";

interface ApiEvent {
  id: number;
  title: string;
  source_image_url: string | null;
  display_handle?: string | null;
  ig_handle?: string | null;
}

export async function fetchEventImages(limit = 48): Promise<EventImage[]> {
  try {
    const res = await fetch(EVENTS_API);
    if (!res.ok) return [];

    const json = (await res.json()) as { results?: ApiEvent[] };
    return (
      json.results
        ?.filter((event) => Boolean(event.source_image_url))
        .map<EventImage>((event) => ({
          id: event.id,
          title: event.title,
          organization: event.display_handle ?? event.ig_handle ?? null,
          source_image_url: event.source_image_url as string,
        }))
        .slice(0, limit) ?? []
    );
  } catch {
    return [];
  }
}
