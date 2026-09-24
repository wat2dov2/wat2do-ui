import { isVirtualLocation } from "@/shared/utils/event";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";

interface EventLocationMapProps {
  location?: string | null;
  school?: string | null;
}

export function EventLocationMap({ location, school }: EventLocationMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const physicalLocation = location?.trim();
  const { getSchoolName } = useSchoolDirectory();

  if (!physicalLocation || isVirtualLocation(physicalLocation) || !apiKey) {
    return null;
  }

  const schoolName = school?.trim() ? getSchoolName(school) : null;
  const query = schoolName
    ? `${physicalLocation}, ${schoolName}`
    : physicalLocation;
  const src = `https://www.google.com/maps/embed/v1/place?key=${apiKey}&q=${encodeURIComponent(query)}`;

  return (
    <iframe
      title={physicalLocation}
      src={src}
      height={256}
      referrerPolicy="no-referrer-when-downgrade"
      className="mt-2 w-full rounded-lg border-0"
      allowFullScreen
    />
  );
}
