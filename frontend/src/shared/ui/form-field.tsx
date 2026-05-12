import React from "react";
import { Calendar as CalendarIcon, ChevronDownIcon } from "lucide-react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover";
import { Calendar } from "@/shared/ui/calendar";
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
  labelIcon?: React.ReactNode;
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

interface FormDatePickerProps extends BaseFormFieldProps {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
}

interface FormTextareaProps extends BaseFormFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}

/**
 * Reusable form input field with validation
 */
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
        {required && <span className="text-error">*</span>}
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

/**
 * Reusable form select field with validation
 */
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
        {required && <span className="text-error">*</span>}
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

/**
 * Reusable form date picker field with validation
 */
export function FormDatePicker({
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
}: FormDatePickerProps) {
  const { t } = useTranslation();
  const hasError = touched && error;
  const id = `field-${name}`;

  return (
    <Field className={className}>
      <FieldLabel
        htmlFor={id}
        className="text-sm font-medium text-foreground flex items-center gap-1.5"
      >
        {labelIcon || <CalendarIcon className="size-4" />}
        {label}
        {required && <span className="text-error">*</span>}
      </FieldLabel>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            data-empty={!value}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80 px-3 py-1 text-base md:text-sm h-9 whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[empty=true]:text-muted-foreground [&_svg]:shrink-0 [&_svg]:size-4 [&_svg]:opacity-50",
              hasError && "ring-2 ring-destructive/50 bg-destructive/10"
            )}
            onBlur={onBlur}
          >
            <span className="truncate">
              {value ? format(value, "PPP") : (placeholder || t("forms.pickDate"))}
            </span>
            <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={onChange}
            defaultMonth={value}
          />
        </PopoverContent>
      </Popover>
      {hasError && (
        <FieldError className="text-xs">{error}</FieldError>
      )}
    </Field>
  );
}

/**
 * Reusable form textarea field with validation
 */
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
        {required && <span className="text-error">*</span>}
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
