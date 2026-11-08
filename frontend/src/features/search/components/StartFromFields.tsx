import { useId, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { FormGrid } from "@/shared/layout/form-grid";
import { Field, FieldLabel } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { START_FROM_NOW } from "@/shared/constants/eventFilters";
import { toLocalDateTimeInput } from "@/shared/utils/date";
import { isPickedStartFrom } from "@/features/search/api/filterService";

export interface StartFromControls {
  startFrom: string;
  setStartFrom: (value: string) => void;
  /** The moment the default start stands for, or null before the clock is known. */
  startNowMs: number | null;
}

interface StartFromFieldsProps extends StartFromControls {
  timeZone: string;
}

/**
 * The start filter's date and time. By default they show the clock (school
 * time); emptying the date removes the start, so past events are listed too.
 * Edits apply when the reader leaves a field or presses Enter, not per
 * keystroke, since each applied start can read the event history again.
 */
export function StartFromFields({ startFrom, setStartFrom, startNowMs, timeZone }: StartFromFieldsProps) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const applied = startFrom === START_FROM_NOW
    ? (startNowMs === null ? "" : toLocalDateTimeInput(startNowMs, timeZone))
    : startFrom;
  const shown = draft ?? applied;
  const date = shown.slice(0, 10);
  const time = shown.slice(11, 16);

  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    // A date still being typed, or an implausible one, is dropped rather than applied.
    if (draft === "" || isPickedStartFrom(draft)) setStartFrom(draft);
  };
  const commitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commit();
  };

  return (
    <FormGrid columns={2} collapse={false}>
      <Field>
        <FieldLabel htmlFor={`${id}-date`}>{t("filters.startDate")}</FieldLabel>
        <Input
          id={`${id}-date`}
          type="date"
          value={date}
          onChange={event => {
            const nextDate = event.currentTarget.value;
            setDraft(nextDate ? `${nextDate}T${time || "00:00"}` : "");
          }}
          onBlur={commit}
          onKeyDown={commitOnEnter}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-time`}>{t("filters.startTime")}</FieldLabel>
        <Input
          id={`${id}-time`}
          type="time"
          value={time}
          disabled={!date}
          onChange={event => setDraft(`${date}T${event.currentTarget.value || "00:00"}`)}
          onBlur={commit}
          onKeyDown={commitOnEnter}
        />
      </Field>
    </FormGrid>
  );
}
