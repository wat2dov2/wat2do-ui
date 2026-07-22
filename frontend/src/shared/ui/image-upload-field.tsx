import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { X, ImagePlus } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { Field, FieldLabel, FieldError } from "@/shared/ui/field";

interface ImageUploadFieldProps {
  label: string;
  required?: boolean;
  imagePreview?: string;
  error?: string;
  onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveImage: () => void;
  fileInputRef?: React.RefObject<HTMLInputElement>;
  className?: string;
  multiple?: boolean;
}

export function ImageUploadField({
  label,
  required = false,
  imagePreview,
  error,
  onImageUpload,
  onRemoveImage,
  fileInputRef: externalRef,
  className = "",
  multiple = false,
}: ImageUploadFieldProps) {
  const { t } = useTranslation();
  const internalRef = useRef<HTMLInputElement>(null);
  const fileInputRef = externalRef || internalRef;

  return (
    <Field className={className}>
      <FieldLabel className="text-sm font-medium text-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </FieldLabel>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={onImageUpload}
        className="hidden"
        multiple={multiple}
      />
      {imagePreview ? (
        <div className="relative">
          <div className="relative w-full h-48 rounded-xl overflow-hidden border border-border">
            <img
              src={imagePreview}
              alt={t("qrCode.posterPreview")}
              className="w-full h-full object-cover"
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onMouseDown={onRemoveImage}
            className="absolute top-2 right-2"
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onMouseDown={() => fileInputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-xl bg-secondary px-3 py-6 text-center text-secondary-foreground shadow-xs transition-[color,box-shadow] outline-none hover:bg-secondary-hover focus-visible:ring-[3px] focus-visible:ring-ring/50 cursor-pointer"
        >
          <ImagePlus className="size-8 text-muted-foreground" />
          <p className="text-base font-medium md:text-sm">
            {t("forms.clickToUploadImage")}
          </p>
          <p className="text-sm text-muted-foreground">{t("qrCode.imageFormat")}</p>
        </button>
      )}
      {error && <FieldError className="text-xs">{error}</FieldError>}
    </Field>
  );
}
