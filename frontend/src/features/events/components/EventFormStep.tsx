import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  DialogClose,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { LoadingButton } from "@/shared/ui/loading-button";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  Field,
  FieldGroup,
  FieldSeparator,
} from "@/shared/ui/field";
import { AIGenerationInput } from "@/features/search";
import { EventFormPreview } from "@/features/events/components/EventForm/EventForm/EventFormPreview";
import { EventFormJSON } from "@/features/events/components/EventForm/EventFormJSON";
import { EventFormFields } from "@/features/events/components/EventForm/EventForm/EventFormFields";
import { EventFormProvider } from "@/features/events/components/EventForm/EventForm/EventFormContext";
import type { ViewMode } from "@/features/events/components/SubmitEventModal.reducer";
import type { useEventForm } from "@/features/events/hooks/useEventForm";

/** The subset of useEventForm's return value that EventFormStep needs. */
type EventFormHookReturn = ReturnType<typeof useEventForm>;

interface EventFormStepProps {
  isEditMode: boolean;
  canCreateEvents: boolean;
  viewMode: ViewMode;
  onViewModeChange: (value: ViewMode) => void;
  isSubmitting: boolean;
  onSubmit: () => void;
  eventForm: Pick<
    EventFormHookReturn,
    | "formData"
    | "updateField"
    | "errors"
    | "touched"
    | "handleBlur"
    | "selectedDate"
    | "handleDateChange"
    | "foodInput"
    | "setFoodInput"
    | "addFood"
    | "removeFood"
    | "jsonValue"
    | "jsonError"
    | "handleJsonChange"
    | "syncToJSON"
    | "imagePreview"
    | "imageFile"
    | "onImageUpload"
    | "onRemoveImage"
    | "isValid"
  >;
  eventFormAI: {
    aiPrompt: string;
    setAiPrompt: (value: string) => void;
    aiGenerating: boolean;
    handleAiGenerate: () => Promise<void>;
  };
  isDarkMode: boolean;
}

export function EventFormStep({
  isEditMode,
  canCreateEvents,
  viewMode,
  onViewModeChange,
  isSubmitting,
  onSubmit,
  eventForm,
  eventFormAI,
  isDarkMode,
}: EventFormStepProps) {
  const { t } = useTranslation();

  const handleViewModeTabChange = useCallback(
    (value: string) => onViewModeChange(value as ViewMode),
    [onViewModeChange]
  );

  // Memoize the context value so consumers (6 components) only re-render when
  // form state actually changes, not on every parent render.
  const formContextValue = useMemo(
    () => ({
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
      imagePreview: eventForm.imagePreview,
      imageFile: eventForm.imageFile,
      onImageUpload: eventForm.onImageUpload,
      onRemoveImage: eventForm.onRemoveImage,
      aiPrompt: eventFormAI.aiPrompt,
      setAiPrompt: eventFormAI.setAiPrompt,
      aiGenerating: eventFormAI.aiGenerating,
      handleAiGenerate: eventFormAI.handleAiGenerate,
      isDarkMode,
    }),
    [eventForm, eventFormAI, isDarkMode]
  );

  return (
    <EventFormProvider value={formContextValue}>
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Form Panel */}
        <div className="flex-1 p-6 overflow-y-auto min-h-0">
          {/* Header with Tabs */}
          <div className="mb-7">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-semibold text-foreground">
                  {isEditMode
                    ? t("events.updateEvent")
                    : canCreateEvents
                      ? t("events.createEvent")
                      : t("events.submitEventForReview")}
                </h2>
              </div>
              <div className="shrink-0">
                <Tabs
                  value={viewMode}
                  onValueChange={handleViewModeTabChange}
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
                  <LoadingButton
                    type="button"
                    onClick={onSubmit}
                    disabled={!eventForm.isValid}
                    isLoading={isSubmitting}
                    loadingText={t("common.pleaseWait")}
                  >
                    {isEditMode
                      ? t("events.updateEvent")
                      : canCreateEvents
                        ? t("events.createEvent")
                        : t("events.submitForReview")}
                  </LoadingButton>
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
  );
}
