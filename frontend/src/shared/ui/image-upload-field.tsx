import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { X, ImagePlus } from "@/shared/ui/doodle-icons";
import { Button, OUTLINE_CONTROL_STYLES } from "@/shared/ui/button";
import { Field, FieldLabel, FieldError } from "@/shared/ui/field";
import { cn } from "@/shared/lib/utils";

const PREVIEW_STYLES = {
  thumbnail: {
    container: "h-48",
    image: "size-full object-cover",
  },
  poster: {
    container:
      "flex max-h-(--container-2xl) items-center justify-center bg-secondary/30",
    image: "block max-h-(--container-2xl) max-w-full object-contain",
  },
} as const;

interface ImageUploadFieldProps {
  label: string;
  required?: boolean;
  imagePreview?: string;
  error?: string;
  onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveImage?: () => void;
  accept?: string;
  fileInputRef?: React.RefObject<HTMLInputElement>;
  className?: string;
  multiple?: boolean;
  previewVariant?: keyof typeof PREVIEW_STYLES;
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
  accept = "image/*",
  previewVariant = "thumbnail",
}: ImageUploadFieldProps) {
  const { t } = useTranslation();
  const internalRef = useRef<HTMLInputElement>(null);
  const fileInputRef = externalRef || internalRef;
  const previewStyles = PREVIEW_STYLES[previewVariant];

  return (
    <Field className={className}
      onDragOver={(event) => {
        if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length || !fileInputRef.current) return;
        event.preventDefault();
        const transfer = new DataTransfer();
        Array.from(event.dataTransfer.files).slice(0, multiple ? undefined : 1).forEach((file) => transfer.items.add(file));
        fileInputRef.current.files = transfer.files;
        fileInputRef.current.dispatchEvent(new Event("change", { bubbles: true }));
      }}
    >
      <FieldLabel className="text-sm font-medium text-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </FieldLabel>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={onImageUpload}
        className="hidden"
        multiple={multiple}
      />
      {imagePreview ? (
        <div className="relative">
          <div
            className={cn(
              "relative w-full overflow-hidden rounded-xl border border-border",
              previewStyles.container,
            )}
          >
            <img
              src={imagePreview}
              alt={t("qrCode.posterPreview")}
              className={previewStyles.image}
            />
          </div>
          {onRemoveImage && <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRemoveImage}
            aria-label={t("common.delete")}
            className="absolute top-2 right-2"
          >
            <X className="size-4" />
          </Button>}
        </div>
      ) : (
        <button
          type="button"
          data-elevation="control"
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            OUTLINE_CONTROL_STYLES,
            "flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl px-3 py-6 text-center transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          )}
        >
          <ImagePlus className="size-8 text-muted-foreground" />
          <p className="text-base font-medium md:text-sm">
            {t("forms.clickToUploadImage")}
          </p>
        </button>
      )}
      {error && <FieldError className="text-xs">{error}</FieldError>}
    </Field>
  );
}
