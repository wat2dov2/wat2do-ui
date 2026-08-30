import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Event } from "@/shared/types";
import { Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/shared/ui/field";
import { MultiSelect } from "@/shared/ui/multi-select";

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
  const [draftIds, setDraftIds] = useState(() =>
    selectedIds.filter((selectedId) =>
      occurrences.some((occurrence) => occurrence.id === selectedId),
    ),
  );
  const [saveFailed, setSaveFailed] = useState(false);

  const occurrenceIds = occurrences.map((occurrence) => occurrence.id);

  const getOccurrenceLabel = useCallback(
    (occurrenceId: string) => {
      const occurrence = occurrences.find((item) => item.id === occurrenceId);
      if (!occurrence) return occurrenceId;
      return new Intl.DateTimeFormat(i18n.language, {
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(occurrence.dtstart_utc));
    },
    [i18n.language, occurrences],
  );

  const toggleOccurrence = (occurrenceId: string) => {
    setDraftIds((current) =>
      current.includes(occurrenceId)
        ? current.filter((id) => id !== occurrenceId)
        : [...current, occurrenceId],
    );
  };

  const confirm = async () => {
    if (draftIds.length === 0) return;
    setSaveFailed(false);
    try {
      await onConfirm(draftIds);
    } catch {
      setSaveFailed(true);
    }
  };

  return (
    <Stack gap={4}>
      <Field>
        <FieldLabel>{t("events.goingEvents.chooseOccurrences")}</FieldLabel>
        <FieldDescription>
          {t("events.goingEvents.chooseOccurrencesDescription")}
        </FieldDescription>
        <MultiSelect
          options={occurrenceIds}
          selected={draftIds}
          onToggle={toggleOccurrence}
          getLabel={getOccurrenceLabel}
        />
      </Field>
      <FieldError>
        {saveFailed ? t("events.goingEvents.saveFailed") : null}
      </FieldError>
      <Stack direction="horizontal" gap={2}>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isPending}
          className="flex-1"
        >
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          onClick={() => void confirm()}
          disabled={isPending || draftIds.length === 0}
          className="flex-1"
        >
          {isPending ? t("common.saving") : t("common.confirm")}
        </Button>
      </Stack>
    </Stack>
  );
}
