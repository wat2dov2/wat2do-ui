import { isVirtualLocation } from "@/features/events/lib/isVirtualLocation";
import { isAllSchools, resolveSchool } from "@/shared/constants/schools";

interface EventLocationMapProps {
  location?: string | null;
  school?: string | null;
}

export function EventLocationMap({ location, school }: EventLocationMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const physicalLocation = location?.trim();

  if (!physicalLocation || isVirtualLocation(physicalLocation) || !apiKey) {
    return null;
  }

  const schoolSlug =
    school?.trim() && !isAllSchools(school)
      ? resolveSchool(school)
      : null;
  const query = schoolSlug
    ? `${physicalLocation}, ${schoolSlug}`
    : physicalLocation;
  const src = `https://www.google.com/maps/embed/v1/place?key=${apiKey}&q=${encodeURIComponent(query)}`;

  return (
    <iframe
      title={physicalLocation}
      src={src}
      height={256}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      className="mt-2 w-full rounded-lg border-0"
      allowFullScreen
    />
  );
}
