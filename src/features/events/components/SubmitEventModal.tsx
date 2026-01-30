import React, { useReducer, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  Field,
  FieldGroup,
  FieldSeparator,
} from "@/shared/ui/field";
import { AIGenerationInput } from "@/features/search";
import { useEventForm } from "@/features/events/hooks/useEventForm";
import { useEventFormAI } from "@/features/events/hooks/useEventFormAI";
import { useEventFormPromotion } from "@/features/events/hooks/useEventFormPromotion";
import { useDarkMode } from "@/shared/hooks/useDarkMode";
import { useSuccessAlert } from "@/shared/hooks/useSuccessAlert";
import { useConfetti } from "@/shared/hooks/useConfetti";
import { useModalState } from "@/shared/hooks/useModalState";
import { EventSuccessScreen } from "@/features/events/components/EventForm/EventForm/EventSuccessScreen";
import { PromotionUpsell } from "@/features/events/components/EventForm/EventForm/PromotionUpsell";
import { PromotionSuccessScreen } from "@/features/events/components/EventForm/EventForm/PromotionSuccessScreen";
import { EventFormPreview } from "@/features/events/components/EventForm/EventForm/EventFormPreview";
import { EventFormJSON } from "@/features/events/components/EventForm/EventFormJSON";
import { EventFormFields } from "@/features/events/components/EventForm/EventForm/EventFormFields";
import { EventFormProvider } from "@/features/events/components/EventForm/EventForm/EventFormContext";
import {
  submitEventModalReducer,
  initialSubmitEventModalState,
  type ViewMode,
} from "@/features/events/components/SubmitEventModal.reducer";
import {
  SubmitEventModalProvider,
  useSubmitEventModalContext,
} from "@/features/events/components/SubmitEventModal.context";
import type { EventFormData } from "@/shared/types";

interface SubmitEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (event: EventFormData) => number;
  userCredits?: number;
  onPromote?: (
    eventId: number,
    packageId: string,
    credits: number,
    duration: number
  ) => boolean;
  onBuyCredits?: () => void;
  editEventId?: number;
  initialData?: EventFormData;
  onUpdate?: (eventId: number, event: EventFormData) => void;
}

function SubmitEventModalContent() {
  const { t } = useTranslation();
  const context = useSubmitEventModalContext();
  const {
    isOpen,
    onClose,
    onSubmit,
    userCredits,
    onPromote,
    onBuyCredits,
    editEventId,
    initialData,
    onUpdate,
    isEditMode,
  } = context;
  const { isDarkMode } = useDarkMode();

  // State management with reducer
  const [state, dispatch] = useReducer(
    submitEventModalReducer,
    initialSubmitEventModalState
  );

  // Success alert hook
  const { show: showSuccessAlert, SuccessAlertComponent } = useSuccessAlert({ onClose });
  
  // Confetti hook
  const { trigger: triggerConfetti } = useConfetti();

  // Use hooks for business logic
  const eventForm = useEventForm({
    initialData,
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

  // Reset state when modal opens
  const resetState = useCallback(() => {
    dispatch({ type: "RESET" });
    eventFormPromotion.setSelectedPromotion(null);
    eventFormPromotion.setPromotionSuccess(false);
    eventFormPromotion.setShowPromotion(false);
  }, [eventFormPromotion]);

  const handleClose = useCallback(() => {
    // If we just created an event, show success alert
    if (state.isSubmitted && !isEditMode && state.createdEventId) {
      showSuccessAlert(
        t("events.eventCreated"),
        t("events.eventCreatedMessage", { title: eventForm.formData.title })
      );
    } else {
      onClose();
    }
  }, [state.isSubmitted, state.createdEventId, isEditMode, showSuccessAlert, t, eventForm.formData.title, onClose]);

  // Use modal state hook for standardized open/close handling
  const modalState = useModalState({
    onClose: handleClose,
    resetOnClose: true,
    resetFn: resetState,
  });

  // Sync formData to JSON when switching to JSON view
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
    eventForm.markAllFieldsTouched();

    if (!eventForm.isValid) {
      return;
    }

    // If in edit mode, update the event
    if (isEditMode && editEventId && onUpdate) {
      onUpdate(editEventId, eventForm.formData);
      showSuccessAlert(
        t("events.eventUpdated"),
        t("events.eventUpdatedMessage", { title: eventForm.formData.title })
      );
      return;
    }

    // Otherwise, create new event
    const eventId = onSubmit(eventForm.formData);
    dispatch({ type: "SET_CREATED_EVENT_ID", payload: eventId });
    dispatch({ type: "SET_IS_SUBMITTED", payload: true });
    
    // Trigger confetti immediately after successful submission (if not showing promotion)
    if (!eventFormPromotion.showPromotion) {
      triggerConfetti();
    }
  }, [
    eventForm,
    isEditMode,
    editEventId,
    onUpdate,
    onSubmit,
    showSuccessAlert,
    t,
    eventFormPromotion.showPromotion,
    triggerConfetti,
  ]);

  // Promotion success screen
  if (eventFormPromotion.promotionSuccess) {
    return (
      <PromotionSuccessScreen
        isOpen={isOpen}
        onClose={handleClose}
        userCredits={userCredits}
      />
    );
  }

  // Promotion upsell screen
  if (eventFormPromotion.showPromotion) {
    return (
      <PromotionUpsell
        isOpen={isOpen}
        onClose={handleClose}
        onPromote={eventFormPromotion.handlePromote}
        onBuyCredits={onBuyCredits || (() => {})}
        userCredits={userCredits}
        selectedPromotion={eventFormPromotion.selectedPromotion}
        onSelectPromotion={eventFormPromotion.setSelectedPromotion}
      />
    );
  }

  // Success screen (skip for edit mode)
  if (state.isSubmitted && !isEditMode) {
    return (
      <EventSuccessScreen
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
    );
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={modalState.handleOpenChange}>
        <DialogContent
          className="p-0 w-[calc(100vw-48px)] max-w-[900px] h-[calc(100vh-48px)] max-h-[750px] overflow-hidden flex flex-col"
          showCloseButton={true}
          aria-describedby={undefined}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>
              {isEditMode ? t("events.updateEvent") : t("events.createEvent")}
            </DialogTitle>
          </DialogHeader>
          <EventFormProvider
            value={{
              formData: eventForm.formData,
              updateField: eventForm.updateField,
              errors: eventForm.errors,
              touched: eventForm.touched,
              handleBlur: eventForm.handleBlur,
              selectedDate: eventForm.selectedDate,
              handleDateChange: eventForm.handleDateChange,
              foodInput: eventForm.foodInput,
              setFoodInput: eventForm.setFoodInput,
              addFood: eventForm.addFood,
              removeFood: eventForm.removeFood,
              jsonValue: eventForm.jsonValue,
              jsonError: eventForm.jsonError,
              handleJsonChange: eventForm.handleJsonChange,
              syncToJSON: eventForm.syncToJSON,
              aiPrompt: eventFormAI.aiPrompt,
              setAiPrompt: eventFormAI.setAiPrompt,
              aiGenerating: eventFormAI.aiGenerating,
              handleAiGenerate: eventFormAI.handleAiGenerate,
              isDarkMode,
            }}
          >
            <div className="flex flex-1 min-h-0 overflow-hidden">
              {/* Form Panel */}
              <div className="flex-1 p-6 overflow-y-auto min-h-0">
                {/* Header with Tabs */}
                <div className="mb-7">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-xl font-bold text-foreground">
                        {isEditMode ? t("events.updateEvent") : t("events.createEvent")}
                      </h2>
                    </div>
                    <div className="shrink-0">
                      <Tabs
                        value={state.viewMode}
                        onValueChange={(value) => handleViewModeChange(value as ViewMode)}
                        className="w-fit"
                      >
                        <TabsList variant="default" className="h-8">
                          <TabsTrigger
                            value="visual"
                            className="text-[11px] font-medium px-3 py-1"
                          >
                            {t("settings.appearance.visual")}
                          </TabsTrigger>
                          <TabsTrigger
                            value="json"
                            className="text-[11px] font-medium px-3 py-1"
                          >
                            {t("settings.appearance.json")}
                          </TabsTrigger>
                        </TabsList>
                      </Tabs>
                    </div>
                  </div>
                </div>

                {state.viewMode === "visual" ? (
                  <FieldGroup>
                    {/* AI Generation Input */}
                    <Field>
                      <AIGenerationInput
                        aiPrompt={eventFormAI.aiPrompt}
                        onAiPromptChange={eventFormAI.setAiPrompt}
                        onAiPromptClear={() => eventFormAI.setAiPrompt("")}
                        aiGenerating={eventFormAI.aiGenerating}
                        onAiGenerate={eventFormAI.handleAiGenerate}
                        error={eventForm.jsonError}
                        title={t("forms.aiEventGeneration")}
                        placeholder={t("forms.aiPromptPlaceholder")}
                        generatingText={t("common.generating")}
                        className="space-y-2"
                        inputClassName="w-full bg-muted text-xs px-3 py-2 pr-8 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-gray-600 dark:focus:border-gray-700 border border-border placeholder:text-muted-foreground disabled:opacity-60"
                      />
                    </Field>
                    <FieldSeparator />
                    <form>
                      <EventFormFields />
                      <Field orientation="horizontal" className="mt-6">
                        <DialogClose asChild>
                          <Button variant="outline" type="button">
                            {t("common.cancel")}
                          </Button>
                        </DialogClose>
                        <Button
                          type="button"
                          onClick={handleSubmit}
                          disabled={!eventForm.isValid}
                        >
                          {isEditMode
                            ? t("events.updateEvent")
                            : t("events.createEvent")}
                        </Button>
                      </Field>
                    </form>
                  </FieldGroup>
                ) : (
                  /* JSON View */
                  <EventFormJSON />
                )}
              </div>

              {/* Live Preview Panel */}
              <EventFormPreview />
            </div>
          </EventFormProvider>
        </DialogContent>
      </Dialog>
      <SuccessAlertComponent />
    </>
  );
}

export function SubmitEventModal(props: SubmitEventModalProps) {
  const isEditMode = !!props.editEventId && !!props.initialData;
  
  return (
    <SubmitEventModalProvider
      value={{
        ...props,
        userCredits: props.userCredits ?? 0,
        isEditMode,
      }}
    >
      <SubmitEventModalContent />
    </SubmitEventModalProvider>
  );
}

export default SubmitEventModal;
