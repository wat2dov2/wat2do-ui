import { useId } from "react";
import { useTranslation } from "react-i18next";
import { FormGrid } from "@/shared/layout/form-grid";
import { Field, FieldLabel } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { START_FROM_NOW } from "@/shared/constants/eventFilters";
import { toLocalDateTimeInput } from "@/shared/utils/date";

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
 */
export function StartFromFields({ startFrom, setStartFrom, startNowMs, timeZone }: StartFromFieldsProps) {
  const { t } = useTranslation();
  const id = useId();
  const shown = startFrom === START_FROM_NOW
    ? (startNowMs === null ? "" : toLocalDateTimeInput(startNowMs, timeZone))
    : startFrom;
  const date = shown.slice(0, 10);
  const time = shown.slice(11, 16);
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
            setStartFrom(nextDate ? `${nextDate}T${time || "00:00"}` : "");
          }}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-time`}>{t("filters.startTime")}</FieldLabel>
        <Input
          id={`${id}-time`}
          type="time"
          value={time}
          disabled={!date}
          onChange={event => setStartFrom(`${date}T${event.currentTarget.value || "00:00"}`)}
        />
      </Field>
    </FormGrid>
  );
}
