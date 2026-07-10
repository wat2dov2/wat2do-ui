import { isVirtualLocation } from "@/features/events/lib/isVirtualLocation";

interface EventLocationMapProps {
  location: string;
  school?: string | null;
}

export function EventLocationMap({ location, school }: EventLocationMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!location.trim() || isVirtualLocation(location) || !apiKey) {
    return null;
  }

  const query = encodeURIComponent(`${location}, ${school ?? ""}`);
  const src = `https://www.google.com/maps/embed/v1/place?key=${apiKey}&q=${query}`;

  return (
    <iframe
      title={location}
      src={src}
      height={256}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      className="mt-2 w-full rounded-lg border-0"
      allowFullScreen
    />
  );
}
