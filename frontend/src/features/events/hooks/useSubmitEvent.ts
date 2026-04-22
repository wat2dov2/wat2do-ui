import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useSuccessAlert } from "@/shared/hooks/useSuccessAlert";
import { useConfetti } from "@/shared/hooks/useConfetti";
import { showToast } from "@/shared/ui/toast";
import { ApiError } from "@/shared/services/apiClient";
import type { EventFormData } from "@/shared/types";

interface UseSubmitEventOptions {
  isEditMode: boolean;
  editEventId?: number;
  onSubmit: (event: EventFormData) => number | Promise<number>;
  onUpdate?: (eventId: number, event: EventFormData) => void | Promise<void>;
  onClose: () => void;
  showPromotion: boolean;
  onCreated: (eventId: number) => void;
}

/**
 * Hook that encapsulates the event submission orchestration:
 * API call, image upload, analytics/confetti, and edit-mode handling.
 */
export function useSubmitEvent({
  isEditMode,
  editEventId,
  onSubmit,
  onUpdate,
  onClose,
  showPromotion,
  onCreated,
}: UseSubmitEventOptions) {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { show: showSuccessAlert, SuccessAlertComponent } = useSuccessAlert({ onClose });
  const { trigger: triggerConfetti } = useConfetti();

  const handleSubmit = useCallback(
    async (formData: EventFormData, imageFile: File | null, markAllFieldsTouched: () => void, isValid: boolean) => {
      markAllFieldsTouched();
      if (!isValid) return;
      setIsSubmitting(true);
      try {
        if (isEditMode && editEventId && onUpdate) {
          await onUpdate(editEventId, formData);
          showSuccessAlert(
            t("events.eventUpdated"),
            t("events.eventUpdatedMessage", { title: formData.title })
          );
          return;
        }
        const eventId = await onSubmit(formData);
        onCreated(eventId);
        if (imageFile && eventId) {
          import("@/shared/services/uploadService").then(({ uploadEventImage }) => {
            uploadEventImage(eventId, imageFile).catch((err) =>
              console.error("Failed to upload event image:", err)
            );
          });
        }
        if (!showPromotion) {
          triggerConfetti();
        }
      } catch (err) {
        console.error("Failed to submit event:", err);
        // Surface backend error to the user as a toast, falling back to a
        // generic message when err is not an ApiError.
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : t("events.submitFailed") || "Failed to submit event";
        showToast(message, "error");
      } finally {
        setIsSubmitting(false);
      }
    },
    [isEditMode, editEventId, onUpdate, onSubmit, showSuccessAlert, t, showPromotion, triggerConfetti, onCreated]
  );

  return {
    isSubmitting,
    handleSubmit,
    showSuccessAlert,
    SuccessAlertComponent,
  };
}
