import React from "react";
import { Calendar as CalendarIcon, ChevronDownIcon } from "lucide-react";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldLabel,
  FieldError,
} from "@/components/ui/field";
import { cn } from "@/lib/utils";

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
        "w-full text-xs",
        hasError && "border-error bg-error/10",
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
            hasError && "border-error bg-error/10"
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
  const hasError = touched && error;
  const id = `field-${name}`;

  return (
    <Field className={className}>
      <FieldLabel
        htmlFor={id}
        className="text-sm font-medium text-foreground flex items-center gap-1.5"
      >
        {labelIcon || <CalendarIcon className="w-4 h-4" />}
        {label}
        {required && <span className="text-error">*</span>}
      </FieldLabel>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            id={id}
            data-empty={!value}
            className={cn(
              "w-full justify-between text-left font-normal text-xs h-9 data-[empty=true]:text-muted-foreground",
              hasError && "border-error bg-error/10"
            )}
            onBlur={onBlur}
          >
            {value ? format(value, "PPP") : <span>{placeholder || "Pick a date"}</span>}
            <ChevronDownIcon />
          </Button>
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
          "w-full text-sm",
          hasError && "border-error bg-error/10"
        )}
      />
      {hasError && (
        <FieldError className="text-xs">{error}</FieldError>
      )}
    </Field>
  );
}
