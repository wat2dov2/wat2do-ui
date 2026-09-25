import { useId } from "react";
import { Button } from "@/shared/ui/button";
import { Field, FieldLabel } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

interface IntegerFilterProps {
  value: string | number;
  active: boolean;
  onChange: (value: string) => void;
  label: string;
  inputLabel: string;
}

export function IntegerFilter({ value, active, onChange, label, inputLabel }: IntegerFilterProps) {
  const inputId = useId();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant={active ? "primary" : "outline"} aria-pressed={active}>
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <Field>
          <FieldLabel htmlFor={inputId}>{inputLabel}</FieldLabel>
          <Input
            id={inputId}
            format="integer"
            defaultValue={value}
            onChange={(event) => {
              onChange(event.currentTarget.value);
            }}
          />
        </Field>
      </PopoverContent>
    </Popover>
  );
}
