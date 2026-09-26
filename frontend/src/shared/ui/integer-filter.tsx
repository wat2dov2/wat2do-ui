import { useId, useState } from "react";
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
  preset?: { label: string; value: string };
}

export function IntegerFilter({ value, active, onChange, label, inputLabel, preset }: IntegerFilterProps) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const presetSelected = !active || String(value) === preset?.value;

  return (
    <Popover open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen) setShowInput(false);
    }}>
      <PopoverTrigger asChild>
        <Button size="sm" variant={active ? "primary" : "outline"} aria-pressed={active} aria-expanded={open}>
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start">
        {preset && !showInput ? (
          <div role="listbox" aria-label={label}>
            <Button
              size="sm"
              role="option"
              variant={presetSelected ? "primary" : "ghost"}
              aria-selected={presetSelected}
              className="w-full justify-start"
              onClick={() => {
                onChange(active && String(value) === preset.value ? "" : preset.value);
                setOpen(false);
              }}
            >
              {preset.label}
            </Button>
            <Button
              size="sm"
              role="option"
              variant={!presetSelected ? "primary" : "ghost"}
              aria-selected={!presetSelected}
              className="w-full justify-start"
              onClick={() => setShowInput(true)}
            >
              {inputLabel}
            </Button>
          </div>
        ) : (
          <Field>
            <FieldLabel htmlFor={inputId}>{inputLabel}</FieldLabel>
            <Input
              id={inputId}
              format="integer"
              autoFocus={Boolean(preset)}
              defaultValue={preset && presetSelected ? "" : value}
              onChange={(event) => onChange(event.currentTarget.value)}
            />
          </Field>
        )}
      </PopoverContent>
    </Popover>
  );
}
