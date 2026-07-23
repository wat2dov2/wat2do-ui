import { useId, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

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
  const selectId = useId();
  const [draftId, setDraftId] = useState(
    () =>
      selectedIds.find((selectedId) =>
        occurrences.some((occurrence) => occurrence.id === selectedId),
      ) ??
      occurrences[0]?.id ??
      "",
  );
  const [saveFailed, setSaveFailed] = useState(false);

  const confirm = async () => {
    if (!draftId) return;
    setSaveFailed(false);
    try {
      await onConfirm([draftId]);
    } catch {
      setSaveFailed(true);
    }
  };

  return (
    <Stack gap={4}>
      <Field>
        <FieldLabel htmlFor={selectId}>
          {t("events.goingEvents.chooseOccurrences")}
        </FieldLabel>
        <FieldDescription>
          {t("events.goingEvents.chooseOccurrencesDescription")}
        </FieldDescription>
        <Select
          value={draftId}
          onValueChange={setDraftId}
          disabled={isPending || occurrences.length === 0}
        >
          <SelectTrigger id={selectId} className="w-full">
            <SelectValue
              placeholder={t("events.goingEvents.chooseOccurrences")}
            />
          </SelectTrigger>
          <SelectContent>
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
                <SelectItem key={occurrence.id} value={occurrence.id}>
                  {label}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </Field>
      <FieldError>
        {saveFailed ? t("events.goingEvents.saveFailed") : null}
      </FieldError>
      <Stack direction="horizontal" gap={2}>
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
          disabled={isPending || !draftId}
          className="flex-1"
        >
          {isPending ? t("common.saving") : t("common.confirm")}
        </Button>
      </Stack>
    </Stack>
  );
}
