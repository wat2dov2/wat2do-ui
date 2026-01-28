import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { X, ImagePlus } from "lucide-react";
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
}: ImageUploadFieldProps) {
  const { t } = useTranslation();
  const internalRef = useRef<HTMLInputElement>(null);
  const fileInputRef = externalRef || internalRef;

  return (
    <Field className={className}>
      <FieldLabel className="text-sm font-medium text-foreground">
        {label} {required && <span className="text-error">*</span>}
      </FieldLabel>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={onImageUpload}
        className="hidden"
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
            variant="outline"
            size="sm"
            onClick={onRemoveImage}
            className="absolute top-2 right-2"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-primary transition-colors cursor-pointer bg-muted/50 hover:bg-muted"
        >
          <ImagePlus className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium text-foreground mb-1">
            {t("forms.clickToUploadImage")}
          </p>
          <p className="text-xs text-muted-foreground">{t("qrCode.imageFormat")}</p>
        </button>
      )}
      {error && <FieldError className="text-xs">{error}</FieldError>}
    </Field>
  );
}
