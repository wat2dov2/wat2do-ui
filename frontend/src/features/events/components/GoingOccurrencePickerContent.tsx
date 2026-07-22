import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Event } from "@/shared/types";
import { Button } from "@/shared/ui/button";

type EventOccurrence = NonNullable<Event["occurrences"]>[number];

interface GoingOccurrencePickerContentProps {
  occurrences: EventOccurrence[];
  selectedIds: string[];
  isPending: boolean;
  onConfirm: (occurrenceIds: string[]) => Promise<unknown>;
  onCancel: () => void;
}

export function GoingOccurrencePickerContent({
  occurrences,
  selectedIds,
  isPending,
  onConfirm,
  onCancel,
}: GoingOccurrencePickerContentProps) {
  const { t, i18n } = useTranslation();
  const [draftIds, setDraftIds] = useState(() => new Set(selectedIds));
  const [saveFailed, setSaveFailed] = useState(false);

  const toggleOccurrence = (occurrenceId: string) => {
    setDraftIds((current) => {
      const next = new Set(current);
      if (next.has(occurrenceId)) {
        next.delete(occurrenceId);
      } else {
        next.add(occurrenceId);
      }
      return next;
    });
  };

  const confirm = async () => {
    setSaveFailed(false);
    try {
      await onConfirm(
        occurrences
          .map((occurrence) => occurrence.id)
          .filter((occurrenceId) => draftIds.has(occurrenceId)),
      );
    } catch {
      setSaveFailed(true);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {occurrences.map((occurrence) => {
          const date = new Date(occurrence.dtstart_utc);
          const label = new Intl.DateTimeFormat(i18n.language, {
            weekday: "long",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }).format(date);
          return (
            <label
              key={occurrence.id}
              className="flex cursor-pointer items-center gap-3 rounded-xl border border-border p-3"
            >
              <input
                type="checkbox"
                checked={draftIds.has(occurrence.id)}
                onChange={() => toggleOccurrence(occurrence.id)}
                disabled={isPending}
                className="size-4 accent-primary"
              />
              <span className="text-sm font-medium text-foreground">{label}</span>
            </label>
          );
        })}
      </div>
      {saveFailed && (
        <p role="alert" className="text-sm text-destructive">
          {t("events.goingEvents.saveFailed")}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={isPending}
          className="flex-1"
        >
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          onClick={() => void confirm()}
          disabled={isPending}
          className="flex-1"
        >
          {isPending ? t("common.saving") : t("common.confirm")}
        </Button>
      </div>
    </div>
  );
}
