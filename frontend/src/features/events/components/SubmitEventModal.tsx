import React, { useReducer, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { useEventForm } from "@/features/events/hooks/useEventForm";
import { useEventFormAI } from "@/features/events/hooks/useEventFormAI";
import { useEventFormPromotion } from "@/features/events/hooks/useEventFormPromotion";
import { useSubmitEvent } from "@/features/events/hooks/useSubmitEvent";
import { useDarkMode } from "@/shared/hooks/useDarkMode";
import { useModalState } from "@/shared/hooks/useModalState";
import { EventFormStep } from "@/features/events/components/EventFormStep";
import { SubmitSuccessStep } from "@/features/events/components/SubmitSuccessStep";
import { PromotionUpsell } from "@/features/events/components/EventForm/EventForm/PromotionUpsell";
import { PromotionSuccessScreen } from "@/features/events/components/EventForm/EventForm/PromotionSuccessScreen";
import {
  submitEventModalReducer,
  initialSubmitEventModalState,
  type ViewMode,
} from "@/features/events/components/SubmitEventModal.reducer";
import type { EventFormData } from "@/shared/types";

interface SubmitEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (event: EventFormData) => number | Promise<number>;
  userCredits?: number;
  onPromote?: (
    eventId: number,
    packageId: string,
  ) => Promise<boolean>;
  onBuyCredits?: () => void;
  editEventId?: number;
  initialData?: EventFormData;
  /** When provided, modal will fetch event by id when opening for edit (ensures form is populated from server). */
  loadEventForEdit?: (eventId: number) => Promise<EventFormData>;
  onUpdate?: (eventId: number, event: EventFormData) => void | Promise<void>;
}

interface SubmitEventModalFormBodyProps {
  formInitialData: EventFormData | undefined;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (event: EventFormData) => number | Promise<number>;
  userCredits: number;
  onPromote?: (eventId: number, packageId: string) => Promise<boolean>;
  onBuyCredits?: () => void;
  editEventId?: number;
  onUpdate?: (eventId: number, event: EventFormData) => void | Promise<void>;
  isEditMode: boolean;
}

/** Form body: mounts with formInitialData so edit form is always populated when opened from admin. */
function SubmitEventModalFormBody({
  formInitialData,
  isOpen,
  onClose,
  onSubmit,
  userCredits,
  onPromote,
  onBuyCredits,
  editEventId,
  onUpdate,
  isEditMode,
}: SubmitEventModalFormBodyProps) {
  const { t } = useTranslation();
  const { isDarkMode } = useDarkMode();

  const [state, dispatch] = useReducer(
    submitEventModalReducer,
    initialSubmitEventModalState
  );

  const eventForm = useEventForm({
    initialData: formInitialData,
    isEditMode,
    isOpen,
  });

  const eventFormAI = useEventFormAI({
    formData: eventForm.formData,
    setFormData: eventForm.setFormData,
    setJsonValue: eventForm.setJsonValue,
    setJsonError: eventForm.setJsonError,
  });

  const eventFormPromotion = useEventFormPromotion({
    createdEventId: state.createdEventId,
    userCredits,
    onPromote,
  });

  const handleCreated = useCallback((eventId: number) => {
    dispatch({ type: "SET_CREATED_EVENT_ID", payload: eventId });
    dispatch({ type: "SET_IS_SUBMITTED", payload: true });
  }, []);

  const { isSubmitting, handleSubmit: submitEvent, showSuccessAlert, SuccessAlertComponent } = useSubmitEvent({
    isEditMode,
    editEventId,
    onSubmit,
    onUpdate,
    onClose,
    showPromotion: eventFormPromotion.showPromotion,
    onCreated: handleCreated,
  });

  const resetState = useCallback(() => {
    dispatch({ type: "RESET" });
    eventFormPromotion.setSelectedPromotion(null);
    eventFormPromotion.setPromotionSuccess(false);
    eventFormPromotion.setShowPromotion(false);
  }, [eventFormPromotion]);

  const handleClose = useCallback(() => {
    if (state.isSubmitted && !isEditMode && state.createdEventId) {
      showSuccessAlert(
        t("events.eventCreated"),
        t("events.eventCreatedMessage", { title: eventForm.formData.title })
      );
    } else {
      onClose();
    }
  }, [state.isSubmitted, state.createdEventId, isEditMode, showSuccessAlert, t, eventForm.formData.title, onClose]);

  const modalState = useModalState({
    onClose: handleClose,
    resetOnClose: true,
    resetFn: resetState,
  });

  const handleViewModeChange = useCallback(
    (value: ViewMode) => {
      dispatch({ type: "SET_VIEW_MODE", payload: value });
      if (value === "json") {
        eventForm.syncToJSON();
      }
    },
    [eventForm]
  );

  const handleSubmit = useCallback(() => {
    return submitEvent(eventForm.formData, eventForm.imageFile, eventForm.markAllFieldsTouched, eventForm.isValid);
  }, [submitEvent, eventForm.formData, eventForm.imageFile, eventForm.markAllFieldsTouched, eventForm.isValid]);

  // Step dispatcher: determine which step to render based on state
  type ModalStep = "promotion-success" | "promotion-upsell" | "submit-success" | "form";
  const currentStep: ModalStep = eventFormPromotion.promotionSuccess
    ? "promotion-success"
    : eventFormPromotion.showPromotion
      ? "promotion-upsell"
      : state.isSubmitted && !isEditMode
        ? "submit-success"
        : "form";

  const stepRenderers: Record<ModalStep, () => React.ReactElement> = {
    "promotion-success": () => (
      <PromotionSuccessScreen
        isOpen={isOpen}
        onClose={handleClose}
        userCredits={userCredits}
      />
    ),
    "promotion-upsell": () => (
      <PromotionUpsell
        isOpen={isOpen}
        onClose={handleClose}
        onPromote={eventFormPromotion.handlePromote}
        onBuyCredits={onBuyCredits || (() => {})}
        userCredits={userCredits}
        selectedPromotion={eventFormPromotion.selectedPromotion}
        onSelectPromotion={eventFormPromotion.setSelectedPromotion}
      />
    ),
    "submit-success": () => (
      <SubmitSuccessStep
        isOpen={isOpen}
        onClose={handleClose}
        onPromote={() => eventFormPromotion.setShowPromotion(true)}
        isEditMode={isEditMode}
        onShowSuccessAlert={(message) => {
          showSuccessAlert(
            isEditMode ? t("events.eventUpdated") : t("events.eventCreated"),
            message
          );
        }}
      />
    ),
    "form": () => (
      <>
        <Dialog open={isOpen} onOpenChange={modalState.handleOpenChange}>
          <DialogContent
            className="p-0 w-[calc(100vw-48px)] max-w-[900px] h-[calc(100vh-48px)] max-h-[750px] overflow-hidden flex flex-col outline-none focus:outline-none focus-visible:outline-none"
            showCloseButton={true}
            aria-describedby={undefined}
          >
            <DialogHeader className="sr-only">
              <DialogTitle>
                {isEditMode ? t("events.updateEvent") : t("events.createEvent")}
              </DialogTitle>
            </DialogHeader>
            <EventFormStep
              isEditMode={isEditMode}
              viewMode={state.viewMode}
              onViewModeChange={handleViewModeChange}
              isSubmitting={isSubmitting}
              onSubmit={handleSubmit}
              eventForm={eventForm}
              eventFormAI={eventFormAI}
              isDarkMode={isDarkMode}
            />
          </DialogContent>
        </Dialog>
        <SuccessAlertComponent />
      </>
    ),
  };

  return stepRenderers[currentStep]();
}

interface SubmitEventModalContentProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (event: EventFormData) => number | Promise<number>;
  userCredits: number;
  onPromote?: (eventId: number, packageId: string) => Promise<boolean>;
  onBuyCredits?: () => void;
  editEventId?: number;
  initialData?: EventFormData;
  loadEventForEdit?: (eventId: number) => Promise<EventFormData>;
  onUpdate?: (eventId: number, event: EventFormData) => void | Promise<void>;
  isEditMode: boolean;
}

function SubmitEventModalContent({
  isOpen,
  onClose,
  onSubmit,
  userCredits,
  onPromote,
  onBuyCredits,
  editEventId,
  initialData,
  loadEventForEdit,
  onUpdate,
  isEditMode,
}: SubmitEventModalContentProps) {
  const { t } = useTranslation();

  const [resolvedInitialData, setResolvedInitialData] = useState<EventFormData | undefined>(undefined);
  useEffect(() => {
    if (!isOpen || !editEventId || !loadEventForEdit) return;
    let cancelled = false;
    loadEventForEdit(editEventId)
      .then((data) => {
        if (!cancelled) setResolvedInitialData(data);
      })
      .catch((err) => {
        console.error("Failed to load event for edit:", err);
        if (!cancelled) setResolvedInitialData(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, editEventId, loadEventForEdit]);

  if (isOpen && editEventId && loadEventForEdit && resolvedInitialData === undefined) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="p-0 w-[calc(100vw-48px)] max-w-[900px] max-h-[400px]" showCloseButton aria-describedby={undefined}>
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            {t("common.loading")}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const formInitialData = (isEditMode && (resolvedInitialData ?? initialData)) ?? initialData;
  const formBodyKey = editEventId && loadEventForEdit && resolvedInitialData != null
    ? `edit-${editEventId}-ready`
    : editEventId
      ? `edit-${editEventId}`
      : "create";

  return (
    <SubmitEventModalFormBody
      key={formBodyKey}
      formInitialData={formInitialData}
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={onSubmit}
      userCredits={userCredits}
      onPromote={onPromote}
      onBuyCredits={onBuyCredits}
      editEventId={editEventId}
      onUpdate={onUpdate}
      isEditMode={isEditMode}
    />
  );
}

export function SubmitEventModal(props: SubmitEventModalProps) {
  const isEditMode = !!props.editEventId && (!!props.initialData || !!props.loadEventForEdit);
  // Remount form when switching to a different event so initialData is applied
  const formKey = props.isOpen && props.editEventId ? `edit-${props.editEventId}` : "create";

  return (
    <SubmitEventModalContent
      key={formKey}
      {...props}
      userCredits={props.userCredits ?? 0}
      isEditMode={isEditMode}
    />
  );
}
