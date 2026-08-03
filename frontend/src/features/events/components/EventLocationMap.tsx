import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isVirtualLocation } from "@/features/events/lib/isVirtualLocation";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Button } from "@/shared/ui/button";

interface EventLocationMapProps {
  location?: string | null;
  school?: string | null;
}

export function EventLocationMap({ location, school }: EventLocationMapProps) {
  const { t } = useTranslation();
  const [showMap, setShowMap] = useState(false);
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

  if (!showMap) {
    return (
      <div className="mt-2 flex h-64 w-full items-center justify-center rounded-lg border border-border bg-surface">
        <Button
          type="button"
          variant="secondary"
          onClick={() => setShowMap(true)}
          data-testid="event-map-load"
        >
          {t("events.loadLocationMap")}
        </Button>
      </div>
    );
  }

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
