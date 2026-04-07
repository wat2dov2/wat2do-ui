import { useReducer, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Event } from "@/shared/types";
import { formReducer, initialState, type FormState } from "@/features/qrcode/hooks/useCreateQRCodeForm.reducer";
import { getUniqueEvents, createQRCodeFromState } from "@/features/qrcode/hooks/useCreateQRCodeForm.utils";

export function useCreateQRCodeForm(events: Event[], userEmail: string) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(formReducer, initialState);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Deduplicate events by ID
  const uniqueEvents = useMemo(() => getUniqueEvents(events), [events]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      dispatch({
        type: "SET_ERRORS",
        payload: { ...state.errors, image: t("qrCode.imageFileError") },
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      dispatch({
        type: "SET_ERRORS",
        payload: { ...state.errors, image: t("qrCode.imageSizeError") },
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      dispatch({ type: "SET_IMAGE_URL", payload: dataUrl });
      dispatch({ type: "SET_IMAGE_PREVIEW", payload: dataUrl });
      const newErrors = { ...state.errors };
      delete newErrors.image;
      dispatch({ type: "SET_ERRORS", payload: newErrors });
    };
    reader.onerror = () => {
      dispatch({
        type: "SET_ERRORS",
        payload: { ...state.errors, image: t("qrCode.imageReadError") },
      });
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    dispatch({ type: "SET_IMAGE_URL", payload: "" });
    dispatch({ type: "SET_IMAGE_PREVIEW", payload: "" });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!state.name.trim()) {
      newErrors.name = t("qrCode.nameRequired");
    }
    if (!state.imageUrl) {
      newErrors.image = t("qrCode.posterImageRequired");
    }
    if (state.destinationType === "custom-url" && !state.customUrl.trim()) {
      newErrors.url = t("qrCode.urlRequired");
    }
    if (state.destinationType === "custom-url" && state.customUrl.trim()) {
      try {
        new URL(state.customUrl);
      } catch (err) {
        console.error("Invalid custom URL:", err);
        newErrors.url = t("qrCode.urlInvalid");
      }
    }
    dispatch({ type: "SET_ERRORS", payload: newErrors });
    return Object.keys(newErrors).length === 0;
  };

  const createQRCode = () => createQRCodeFromState(state, userEmail);

  const reset = () => {
    dispatch({ type: "RESET" });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return {
    state,
    dispatch,
    fileInputRef,
    uniqueEvents,
    handleImageUpload,
    handleRemoveImage,
    validate,
    createQRCode,
    reset,
  };
}
