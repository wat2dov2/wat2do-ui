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
  onSubmit: (event: EventFormData) => SubmitEventResult | Promise<SubmitEventResult>;
  onUpdate?: (eventId: number, event: EventFormData) => void | Promise<void>;
  onClose: () => void;
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
        if (isEditMode && editEventId && onUpdate) {
          await onUpdate(editEventId, formData);
          toast({
            title: t("events.eventUpdated"),
            description: t("events.eventUpdatedMessage", { title: formData.title }),
            variant: "success",
          });
          onClose();
          return;
        }
        const result = await onSubmit(formData);
        const eventId = result.type === "event" ? result.eventId : null;
        onSubmitted(eventId);
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
        const message = getApiErrorMessage(err, t("events.submitFailed"));
        toast({
          title: "Submission Failed",
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
