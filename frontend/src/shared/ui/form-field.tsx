import type { ReactNode } from "react";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { DateTimePicker } from "@/shared/ui/date-time-picker";
import {
  Field,
  FieldLabel,
  FieldError,
} from "@/shared/ui/field";
import { cn } from "@/shared/lib/utils";

interface BaseFormFieldProps {
  name: string;
  label: string;
  required?: boolean;
  error?: string;
  touched?: boolean;
  onBlur?: () => void;
  labelIcon?: ReactNode;
  className?: string;
}

interface FormInputProps extends BaseFormFieldProps {
  type?: "text" | "email" | "number" | "time" | "tel" | "url";
  value: string | number;
  onChange: (value: string | number) => void;
  placeholder?: string;
  step?: string;
  min?: string | number;
  prefix?: string;
  inputClassName?: string;
}

interface FormSelectProps extends BaseFormFieldProps {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}


interface FormDateTimePickerProps extends BaseFormFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

interface FormTextareaProps extends BaseFormFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}

export function FormInput({
  name,
  label,
  required = false,
  error,
  touched,
  onBlur,
  labelIcon,
  type = "text",
  value,
  onChange,
  placeholder,
  step,
  min,
  prefix,
  className,
  inputClassName,
}: FormInputProps) {
  const hasError = touched && error;
  const id = `field-${name}`;

  const inputElement = (
    <Input
      id={id}
      type={type}
      value={value}
      onChange={(e) => {
        if (type === "number") {
          const newValue = e.target.value === "" ? 0 : parseFloat(e.target.value) || 0;
          onChange(newValue);
        } else {
          onChange(e.target.value);
        }
      }}
      onBlur={onBlur}
      placeholder={placeholder}
      step={step}
      min={min}
      className={cn(
        "w-full",
        hasError && "ring-2 ring-destructive/50 bg-destructive/10",
        prefix && "pl-7",
        inputClassName
      )}
    />
  );

  return (
    <Field className={className}>
      <FieldLabel
        htmlFor={id}
        className="text-sm font-medium text-foreground flex items-center gap-1.5"
      >
        {labelIcon}
        {label}
        {required && <span className="text-destructive">*</span>}
      </FieldLabel>
      {prefix ? (
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm z-10">
            {prefix}
          </span>
          {inputElement}
        </div>
      ) : (
        inputElement
      )}
      {hasError && (
        <FieldError className="text-xs">{error}</FieldError>
      )}
    </Field>
  );
}

export function FormSelect({
  name,
  label,
  required = false,
  error,
  touched,
  onBlur,
  labelIcon,
  value,
  onChange,
  options,
  placeholder,
  className,
}: FormSelectProps) {
  const hasError = touched && error;
  const id = `field-${name}`;

  return (
    <Field className={className}>
      <FieldLabel
        htmlFor={id}
        className="text-sm font-medium text-foreground flex items-center gap-1.5"
      >
        {labelIcon}
        {label}
        {required && <span className="text-destructive">*</span>}
      </FieldLabel>
      <Select
        value={value}
        onValueChange={(newValue) => {
          onChange(newValue);
          if (onBlur) onBlur();
        }}
      >
        <SelectTrigger
          id={id}
          className={cn(
            "w-full",
            hasError && "ring-2 ring-destructive/50 bg-destructive/10"
          )}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hasError && (
        <FieldError className="text-xs">{error}</FieldError>
      )}
    </Field>
  );
}


export function FormDateTimePicker({
  name,
  label,
  required = false,
  error,
  touched,
  onBlur,
  labelIcon,
  value,
  onChange,
  placeholder,
  className,
}: FormDateTimePickerProps) {
  const hasError = touched && error;
  const id = `field-${name}`;

  return (
    <Field className={className}>
      <FieldLabel
        htmlFor={id}
        className="text-sm font-medium text-foreground flex items-center gap-1.5"
      >
        {labelIcon}
        {label}
        {required && <span className="text-destructive">*</span>}
      </FieldLabel>
      <DateTimePicker
        id={id}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        hasError={Boolean(hasError)}
      />
      {hasError && (
        <FieldError className="text-xs">{error}</FieldError>
      )}
    </Field>
  );
}

export function FormTextarea({
  name,
  label,
  required = false,
  error,
  touched,
  onBlur,
  labelIcon,
  value,
  onChange,
  placeholder,
  rows = 2,
  className,
}: FormTextareaProps) {
  const hasError = touched && error;
  const id = `field-${name}`;

  return (
    <Field className={className}>
      <FieldLabel
        htmlFor={id}
        className="text-sm font-medium text-foreground flex items-center gap-1.5"
      >
        {labelIcon}
        {label}
        {required && <span className="text-destructive">*</span>}
      </FieldLabel>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        rows={rows}
        className={cn(
          "w-full",
          hasError && "ring-2 ring-destructive/50 bg-destructive/10"
        )}
      />
      {hasError && (
        <FieldError className="text-xs">{error}</FieldError>
      )}
    </Field>
  );
}
