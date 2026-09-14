import { useId } from "react";
import { Button } from "@/shared/ui/button";
import { Field, FieldLabel } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

interface MinimumCountFilterProps {
  value: number;
  onChange: (value: number) => void;
  countLabel: string;
  inputLabel: string;
}

export function MinimumCountFilter({ value, onChange, countLabel, inputLabel }: MinimumCountFilterProps) {
  const inputId = useId();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant={value > 0 ? "primary" : "outline"}>
          {">"}{countLabel}
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
              onChange(Number(event.currentTarget.value));
            }}
          />
        </Field>
      </PopoverContent>
    </Popover>
  );
}
