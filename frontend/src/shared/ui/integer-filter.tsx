import { useId, useState } from "react";
import { Button } from "@/shared/ui/button";
import { ChevronDown } from "@/shared/ui/doodle-icons";
import { Field, FieldLabel } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

interface IntegerFilterProps {
  value: string | number;
  active: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  label: string;
  inputLabel: string;
}

export function IntegerFilter({ value, active, disabled = false, onChange, label, inputLabel }: IntegerFilterProps) {
  const inputId = useId();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger activation="click" asChild disabled={disabled}>
        <Button activation="click" disabled={disabled} size="sm" variant={active ? "primary" : "outline"} aria-pressed={active} aria-expanded={open}>
          {label}
          <ChevronDown aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <Field>
          <FieldLabel htmlFor={inputId}>{inputLabel}</FieldLabel>
          <Input
            id={inputId}
            format="integer"
            defaultValue={value}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
        </Field>
      </PopoverContent>
    </Popover>
  );
}
