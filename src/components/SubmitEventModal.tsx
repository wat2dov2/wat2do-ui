import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, ImagePlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldSeparator,
} from "@/components/ui/field";
import { X } from "lucide-react";
import { AIGenerationInput } from "@/components/AIFilterInput";
import { useEventForm } from "@/hooks/useEventForm";
import { useEventFormAI } from "@/hooks/useEventFormAI";
import { useEventFormPromotion } from "@/hooks/useEventFormPromotion";
import { useDarkMode } from "@/hooks/useDarkMode";
import { useSuccessAlert } from "@/hooks/useSuccessAlert";
import { useConfetti } from "@/hooks/useConfetti";
import { EventSuccessScreen } from "./EventForm/EventSuccessScreen";
import { PromotionUpsell } from "./EventForm/PromotionUpsell";
import { PromotionSuccessScreen } from "./EventForm/PromotionSuccessScreen";
import { EventFormPreview } from "./EventForm/EventFormPreview";
import { EventFormJSON } from "./EventForm/EventFormJSON";
import { EventFormFields } from "./EventForm/EventFormFields";
import { EventFormProvider } from "./EventForm/EventFormContext";
import type { EventFormData } from "@/types";

interface ValidationErrors {
  title?: string;
  organization?: string;
  date?: string;
  time?: string;
  location?: string;
}


interface SubmitEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (event: EventFormData) => number; // Returns the created event's ID
  userCredits?: number;
  onPromote?: (
    eventId: number,
    packageId: string,
    credits: number,
    duration: number
  ) => boolean;
  onBuyCredits?: () => void;
  editEventId?: number; // Event ID being edited
  initialData?: EventFormData; // Initial data for edit mode
  onUpdate?: (eventId: number, event: EventFormData) => void; // Update handler for edit mode
}

type ViewMode = "visual" | "json";

interface ValidationErrors {
  title?: string;
  organization?: string;
  date?: string;
  time?: string;
  location?: string;
}

export function SubmitEventModal({
  isOpen,
  onClose,
  onSubmit,
  userCredits = 0,
  onPromote,
  onBuyCredits,
  editEventId,
  initialData,
  onUpdate,
}: SubmitEventModalProps) {
  const { t } = useTranslation();
  const isEditMode = !!editEventId && !!initialData;
  const { isDarkMode } = useDarkMode();

  // View mode state
  const [viewMode, setViewMode] = useState<ViewMode>("visual");
  
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

  const [createdEventId, setCreatedEventId] = useState<number | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const eventFormPromotion = useEventFormPromotion({
    createdEventId,
    userCredits,
    onPromote,
  });

  // Sync formData to JSON when switching to JSON view
  useEffect(() => {
    if (viewMode === "json") {
      eventForm.syncToJSON();
    }
  }, [viewMode, eventForm.formData, eventForm.syncToJSON]);

  // Reset view mode and promotion state when modal opens
  useEffect(() => {
    if (isOpen) {
      setViewMode("visual");
      eventFormPromotion.setSelectedPromotion(null);
      eventFormPromotion.setPromotionSuccess(false);
      eventFormPromotion.setShowPromotion(false);
      setIsSubmitted(false);
      setCreatedEventId(null);
    }
  }, [isOpen, eventFormPromotion]);

  // Fire confetti on success
  useEffect(() => {
    if (isSubmitted && !eventFormPromotion.showPromotion) {
      triggerConfetti();
    }
  }, [isSubmitted, eventFormPromotion.showPromotion, triggerConfetti]);

  const handleSubmit = () => {
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
    setCreatedEventId(eventId);
    setIsSubmitted(true);
  };

  const handleClose = () => {
    // If we just created an event, show success alert
    if (isSubmitted && !isEditMode && createdEventId) {
      showSuccessAlert(
        t("events.eventCreated"),
        t("events.eventCreatedMessage", { title: eventForm.formData.title })
      );
    } else {
      onClose();
    }
  };

  // Promotion success screen
  if (eventFormPromotion.promotionSuccess) {
    return (
      <PromotionSuccessScreen
        isOpen={isOpen}
        onClose={handleClose}
        formData={eventForm.formData}
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
        formData={eventForm.formData}
        userCredits={userCredits}
        selectedPromotion={eventFormPromotion.selectedPromotion}
        onSelectPromotion={eventFormPromotion.setSelectedPromotion}
      />
    );
  }

  // Success screen (skip for edit mode)
  if (isSubmitted && !isEditMode) {
    return (
      <EventSuccessScreen
        isOpen={isOpen}
        onClose={handleClose}
        onPromote={() => eventFormPromotion.setShowPromotion(true)}
        formData={eventForm.formData}
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
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent
          className="p-0 w-[calc(100vw-48px)] max-w-[900px] h-[calc(100vh-48px)] max-h-[750px] overflow-hidden flex flex-col"
          showCloseButton={true}
          aria-describedby={undefined}
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
                      value={viewMode}
                      onValueChange={(value) => setViewMode(value as ViewMode)}
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

              {viewMode === "visual" ? (
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
                      }}
                    >
                      <EventFormFields />
                    </EventFormProvider>
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
                <EventFormJSON
                  jsonValue={eventForm.jsonValue}
                  jsonError={eventForm.jsonError}
                  aiPrompt={eventFormAI.aiPrompt}
                  aiGenerating={eventFormAI.aiGenerating}
                  isDarkMode={isDarkMode}
                  onJsonChange={eventForm.handleJsonChange}
                  onAiPromptChange={eventFormAI.setAiPrompt}
                  onAiGenerate={eventFormAI.handleAiGenerate}
                  onClearAiPrompt={() => eventFormAI.setAiPrompt("")}
                />
              )}
            </div>

            {/* Live Preview Panel */}
            <EventFormPreview formData={eventForm.formData} />
          </div>
        </DialogContent>
      </Dialog>
      <SuccessAlertComponent />
    </>
  );
}

export default SubmitEventModal;
