import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/shared/hooks/use-toast";
import { useConfetti } from "@/shared/hooks/useConfetti";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import type { EventFormData } from "@/shared/types";

export type SubmitEventResult =
  | { type: "event"; eventId: number }
  | { type: "submission" };

interface UseSubmitEventOptions {
  isEditMode: boolean;
  editEventId?: number;
  onSubmit?: (event: EventFormData) => SubmitEventResult | Promise<SubmitEventResult>;
  onUpdate?: (eventId: number, event: EventFormData) => void | Promise<void>;
  /** Absent when the form is an always-present panel with nothing to dismiss. */
  onClose?: () => void;
  showPromotion: boolean;
  onSubmitted: (eventId: number | null) => void;
}

/**
 * Hook that encapsulates the event create/update orchestration:
 * API call, image upload, analytics/confetti, and edit-mode handling.
 */
export function useSubmitEvent({
  isEditMode,
  editEventId,
  onSubmit,
  onUpdate,
  onClose,
  showPromotion,
  onSubmitted,
}: UseSubmitEventOptions) {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { trigger: triggerConfetti } = useConfetti();

  const handleSubmit = useCallback(
    async (formData: EventFormData, imageFile: File | null, markAllFieldsTouched: () => void, isValid: boolean) => {
      markAllFieldsTouched();
      if (!isValid) return;
      setIsSubmitting(true);
      try {
        let finalImageUrl = formData.source_image_url;
        if (imageFile) {
          const { uploadEventImageUnsigned } = await import("@/shared/services/uploadService");
          finalImageUrl = await uploadEventImageUnsigned(imageFile);
        }

        const dataToSubmit = {
          ...formData,
          source_image_url: finalImageUrl,
        };

        if (isEditMode && editEventId && onUpdate) {
          await onUpdate(editEventId, dataToSubmit);
          toast({
            title: t("events.eventUpdated"),
            description: t("events.eventUpdatedMessage", { title: formData.title }),
            variant: "success",
          });
          onClose?.();
          return;
        }
        if (!onSubmit) {
          throw new Error("Event submission handler is not configured");
        }
        const result = await onSubmit(dataToSubmit);
        const eventId = result.type === "event" ? result.eventId : null;
        onSubmitted(eventId);
        if (!showPromotion) {
          triggerConfetti();
        }
      } catch (err) {
        console.error("Failed to submit event:", err);
        // Surface backend error to the user as a toast, falling back to a
        // generic message when err is not an ApiError.
        const message = getApiErrorMessage(err, t("events.submitFailed"));
        toast({
          title: t("events.submissionFailedTitle"),
          description: message,
          variant: "destructive",
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [isEditMode, editEventId, onUpdate, onSubmit, onClose, t, showPromotion, triggerConfetti, onSubmitted]
  );

  return {
    isSubmitting,
    handleSubmit,
  };
}
