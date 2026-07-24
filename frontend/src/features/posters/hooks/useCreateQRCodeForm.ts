import { useState, useRef, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { Event, FilterState } from "@/shared/types";
import { useForm } from "@/shared/hooks/useForm";
import { getUniqueEvents } from "@/shared/utils/event";
import { MAX_IMAGE_UPLOAD_SIZE_BYTES } from "@/shared/constants/uploads";
import { isSafeUrl } from "@/shared/utils/url";

type DestinationType = "event" | "events-list" | "custom-url";

interface CreateQRCodeFormData {
  name: string;
  description: string;
  destinationType: DestinationType;
  selectedEventId: number | undefined;
  customUrl: string;
  filters: FilterState | undefined;
  imageFile: File | undefined;
  imageUrl: string;
  imagePreview: string;
}

const INITIAL_FORM_DATA: CreateQRCodeFormData = {
  name: "",
  description: "",
  destinationType: "event",
  selectedEventId: undefined,
  customUrl: "",
  filters: undefined,
  imageFile: undefined,
  imageUrl: "",
  imagePreview: "",
};

export function useCreateQRCodeForm(events: Event[]) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getDefaults = useCallback(() => INITIAL_FORM_DATA, []);
  const form = useForm<CreateQRCodeFormData>({
    isOpen: true,
    getDefaults,
  });

  // Errors and qrCodeId are not form fields - they live alongside the form.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [qrCodeId, setQrCodeId] = useState<string | null>(null);

  // Deduplicate events by ID
  const uniqueEvents = useMemo(() => getUniqueEvents(events), [events]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setErrors((prev) => ({ ...prev, image: t("qrCode.imageFileError") }));
      return;
    }

    if (file.size > MAX_IMAGE_UPLOAD_SIZE_BYTES) {
      setErrors((prev) => ({ ...prev, image: t("qrCode.imageSizeError") }));
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      form.updateField("imageFile", file);
      form.updateField("imageUrl", dataUrl);
      form.updateField("imagePreview", dataUrl);
      setErrors((prev) => {
        const next = { ...prev };
        delete next.image;
        return next;
      });
    };
    reader.onerror = () => {
      setErrors((prev) => ({ ...prev, image: t("qrCode.imageReadError") }));
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    form.updateField("imageFile", undefined);
    form.updateField("imageUrl", "");
    form.updateField("imagePreview", "");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!form.formData.name.trim()) {
      newErrors.name = t("qrCode.nameRequired");
    }
    if (!form.formData.imageUrl) {
      newErrors.image = t("qrCode.posterImageRequired");
    }
    if (form.formData.destinationType === "custom-url" && !form.formData.customUrl.trim()) {
      newErrors.url = t("qrCode.urlRequired");
    }
    if (form.formData.destinationType === "custom-url" && form.formData.customUrl.trim()) {
      if (!isSafeUrl(form.formData.customUrl.trim())) {
        newErrors.url = t("qrCode.urlInvalid");
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const reset = () => {
    form.setFormData(INITIAL_FORM_DATA);
    setErrors({});
    setQrCodeId(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return {
    formData: form.formData,
    updateField: form.updateField,
    errors,
    qrCodeId,
    setQrCodeId,
    fileInputRef,
    uniqueEvents,
    handleImageUpload,
    handleRemoveImage,
    validate,
    reset,
  };
}
