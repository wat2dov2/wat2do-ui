import { useTranslation } from "react-i18next";
import { EventCard } from "@/features/events/components/EventCard";
import { useEventFormContext } from "@/features/events/components/EventForm/EventForm/EventFormContext";
import { cn } from "@/shared/lib/utils";

interface EventFormPreviewProps {
  className?: string;
}

/**
 * Live preview of the grid card the event will become.
 *
 * It renders the real card against the event the form currently describes, so
 * the preview cannot drift from the feed.
 */
export function EventFormPreview({ className }: EventFormPreviewProps) {
  const { t } = useTranslation();
  const { previewEvent } = useEventFormContext();

  return (
    <div
      className={cn(
        "min-h-0 w-[19rem] shrink-0 flex-col overflow-y-auto border-l border-border bg-background/40 p-4",
        className,
      )}
    >
      <div className="mb-4">
        <span className="whitespace-nowrap text-sm font-semibold text-foreground">
          {t("forms.livePreview")}
        </span>
      </div>

      <EventCard event={previewEvent} interactive={false} className="mx-auto max-w-[16.5rem]" />
    </div>
  );
}
