import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/shared/hooks/use-toast";
import { useConfetti } from "@/shared/hooks/useConfetti";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import { useAuthState, useRequireSignIn } from "@/features/auth";
import { useSaveEventTickets } from "@/features/tickets";
import type { Event, EventFormData } from "@/shared/types";

export type SubmitEventResult =
  | { type: "event"; event: Event }
  | { type: "submission" };

interface UseSubmitEventOptions {
  isEditMode: boolean;
  editEventId?: number;
  /** The event had tickets when the form opened, so turning them off stops them. */
  hadTickets: boolean;
  onSubmit?: (event: EventFormData) => SubmitEventResult | Promise<SubmitEventResult>;
  onUpdate?: (eventId: number, event: EventFormData) => Promise<Event>;
  /** Absent when the form is an always-present panel with nothing to dismiss. */
  onClose?: () => void;
  onSubmitted: (eventId: number | null) => void;
}

/**
 * Hook that encapsulates the event create/update orchestration:
 * API call, image upload, the club's tickets, analytics/confetti, and
 * edit-mode handling.
 */
export function useSubmitEvent({
  isEditMode,
  editEventId,
  hadTickets,
  onSubmit,
  onUpdate,
  onClose,
  onSubmitted,
}: UseSubmitEventOptions) {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { trigger: triggerConfetti } = useConfetti();
  const requireSignIn = useRequireSignIn();
  const { clubs } = useAuthState();
  const saveEventTickets = useSaveEventTickets();

  /**
   * The club's team sets the event's tickets in the same form, saved once the
   * event is. The event stays saved when its tickets are refused, and says so.
   */
  const saveTickets = useCallback(
    async (event: Event, formData: EventFormData): Promise<boolean> => {
      if (!clubs.some((club) => club.id === formData.club_id)) return true;
      try {
        await saveEventTickets(event, formData, hadTickets);
        return true;
      } catch (err) {
        toast({
          title: t("tickets.desk.notSaved"),
          description: getApiErrorMessage(err, t("tickets.errors.generic")),
          variant: "destructive",
        });
        return false;
      }
    },
    [clubs, saveEventTickets, hadTickets, t],
  );

  const handleSubmit = useCallback(
    async (
      formData: EventFormData,
      imageFile: File | null,
      markAllFieldsTouched: () => void,
      isValid: boolean,
    ): Promise<boolean> => {
      markAllFieldsTouched();
      if (!isValid) return false;
      // Anyone can fill in an event; it is sent by a signed-in account.
      if (!(await requireSignIn())) return false;
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
          const event = await onUpdate(editEventId, dataToSubmit);
          // A refused change to the tickets keeps the form open to fix it.
          if (!(await saveTickets(event, dataToSubmit))) return false;
          toast({
            title: t("events.eventUpdated"),
            description: t("events.eventUpdatedMessage", { title: formData.title }),
            variant: "success",
          });
          onClose?.();
          return true;
        }
        if (!onSubmit) {
          throw new Error("Event submission handler is not configured");
        }
        const result = await onSubmit(dataToSubmit);
        if (result.type === "event") await saveTickets(result.event, dataToSubmit);
        onSubmitted(result.type === "event" ? result.event.id : null);
        triggerConfetti();
        return true;
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
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [isEditMode, editEventId, onUpdate, onSubmit, onClose, t, triggerConfetti, onSubmitted, requireSignIn, saveTickets]
  );

  return {
    isSubmitting,
    handleSubmit,
  };
}
