import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { FormGrid } from "@/shared/layout/form-grid";
import { Stack } from "@/shared/layout/stack";
import { Button } from "@/shared/ui/button";
import { ChevronDown } from "@/shared/ui/doodle-icons";
import { Field, FieldLabel } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

interface PriceRangeControls {
  minPrice: string;
  maxPrice: string;
  setMinPrice: (value: string) => void;
  setMaxPrice: (value: string) => void;
}

export function PriceRangeFields({ minPrice, maxPrice, setMinPrice, setMaxPrice }: PriceRangeControls) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <FormGrid columns={2} collapse={false}>
      <Field>
        <FieldLabel htmlFor={`${id}-min`}>{t("filters.minimumPrice")}</FieldLabel>
        <Input id={`${id}-min`} type="number" min="0" step="0.01" value={minPrice} onChange={event => setMinPrice(event.currentTarget.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-max`}>{t("filters.max")}</FieldLabel>
        <Input id={`${id}-max`} type="number" min="0" step="0.01" value={maxPrice} onChange={event => setMaxPrice(event.currentTarget.value)} />
      </Field>
    </FormGrid>
  );
}

export function PriceFilter(controls: PriceRangeControls) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { minPrice, maxPrice, setMinPrice, setMaxPrice } = controls;
  const active = minPrice !== "" || maxPrice !== "";
  const freeOnly = minPrice === "" && maxPrice === "0";
  const label = freeOnly ? t("common.free")
    : minPrice !== "" && maxPrice !== "" ? `$${Number(minPrice)} - $${Number(maxPrice)}`
    : minPrice !== "" ? `≥ $${Number(minPrice)}`
    : maxPrice !== "" ? `≤ $${Number(maxPrice)}`
    : t("filters.anyPrice");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button activation="click" size="sm" variant="outline" aria-pressed={active} aria-expanded={open}>
          {label}
          <ChevronDown aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={t("filters.price")}>
        <Stack gap={3}>
          <Button activation="click" size="sm" variant={freeOnly ? "primary" : "outline"} aria-pressed={freeOnly} onClick={() => {
            setMinPrice("");
            setMaxPrice(freeOnly ? "" : "0");
            setOpen(false);
          }}>
            {t("common.free")}
          </Button>
          <PriceRangeFields {...controls} />
        </Stack>
      </PopoverContent>
    </Popover>
  );
}
