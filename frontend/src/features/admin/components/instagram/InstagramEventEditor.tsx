import { useCallback, useMemo, type MutableRefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { SubmitEventFlow } from "@/features/events/components/SubmitEventModal";
import { fetchEventById } from "@/features/events/api/events.api";
import { controlBox } from "@/shared/config/controlBox";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { queryKeys } from "@/shared/lib/queryKeys";
import { eventToFormData, getEventCategory } from "@/shared/utils/event";
import type { Event, EventFormData } from "@/shared/types";

interface InstagramEventEditorProps {
  eventId: number;
  active: boolean;
  saveRef: MutableRefObject<(() => Promise<boolean>) | null>;
  onUpdate: (eventId: number, data: EventFormData) => Promise<void>;
  onPreviewEventChange: (eventId: number, event: Event) => void;
}

/** Each visited event owns its form, including unsaved image files. */
export function InstagramEventEditor({
  eventId, active, saveRef, onUpdate, onPreviewEventChange,
}: InstagramEventEditorProps) {
  const { getSchoolTimezone } = useSchoolDirectory();
  const { data: event } = useQuery({
    queryKey: queryKeys.events.detail(eventId),
    queryFn: () => fetchEventById(eventId),
    staleTime: controlBox.clientCache.liveEventDataStaleMs,
    refetchOnWindowFocus: false,
  });
  const timeZone = getSchoolTimezone(event?.school);
  const initialData = useMemo(() => event
    ? eventToFormData({ ...event, category: getEventCategory(event) }, timeZone)
    : null, [event, timeZone]);
  const updatePreview = useCallback((preview: Event) => {
    onPreviewEventChange(eventId, preview);
  }, [eventId, onPreviewEventChange]);

  return (
    <div hidden={!active}>
      {initialData && <SubmitEventFlow
        canCreateEvents
        embedded
        isEditMode
        active={active}
        showHeading={false}
        showPreview={false}
        editEventId={eventId}
        initialData={initialData}
        onUpdate={onUpdate}
        previewBase={event}
        onPreviewEventChange={updatePreview}
        saveRef={saveRef}
        showSubmit={false}
      />}
    </div>
  );
}
