import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Organization } from "@/shared/types";
import { getAllOrganizations } from "@/features/organizations";
import { useBackendQuery } from "@/shared/hooks/useBackendQuery";
import { useEventsStore } from "@/features/events/store/events.store";
import { ArrowLeft } from "@/shared/ui/doodle-icons";
import { DrawerClose } from "@/shared/ui/drawer";
import { Button } from "@/shared/ui/button";
import { LoadingButton } from "@/shared/ui/loading-button";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  Field,
  FieldGroup,
  FieldSeparator,
} from "@/shared/ui/field";
import { AIGenerationInput } from "@/shared/ui/ai-generation-input";
import { useProfileCompleted } from "@/features/auth";
import { EventFormPreview } from "@/features/events/components/EventForm/EventForm/EventFormPreview";
import { EventFormJSON } from "@/features/events/components/EventForm/EventFormJSON";
import { EventFormFields } from "@/features/events/components/EventForm/EventForm/EventFormFields";
import { EventFormProvider } from "@/features/events/components/EventForm/EventForm/EventFormContext";
import type { useEventForm } from "@/features/events/hooks/useEventForm";

export type ViewMode = "visual" | "json";

const NO_ORGANIZATIONS: Organization[] = [];

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
    | "updateOccurrence"
    | "addOccurrence"
    | "removeOccurrence"
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
  onBack?: () => void;
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
  onBack,
}: EventFormStepProps) {
  const { t } = useTranslation();
  const profileCompleted = useProfileCompleted();
  const schoolFilter = useEventsStore((s) => s.schoolFilter);

  const fetchOrganizations = useCallback(
    () => getAllOrganizations(schoolFilter ?? undefined),
    [schoolFilter],
  );
  const { data: organizations } = useBackendQuery(fetchOrganizations, NO_ORGANIZATIONS, schoolFilter);

  const selectedOrganizationName = useMemo(() => {
    const id = eventForm.formData.organization_id;
    return id != null ? organizations.find((org) => org.id === id)?.organization_name ?? "" : "";
  }, [organizations, eventForm.formData.organization_id]);

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
      organizations,
      selectedOrganizationName,
      updateOccurrence: eventForm.updateOccurrence,
      addOccurrence: eventForm.addOccurrence,
      removeOccurrence: eventForm.removeOccurrence,
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
    [eventForm, eventFormAI, isDarkMode, organizations, selectedOrganizationName]
  );

  return (
    <EventFormProvider value={formContextValue}>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Form Panel */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {/* Header with Tabs */}
          <div className="mb-5 sm:mb-7">
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between sm:gap-4">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {onBack && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-sm"
                    onMouseDown={onBack}
                    aria-label={t("common.back")}
                  >
                    <ArrowLeft className="size-4" />
                  </Button>
                )}
                <h2 className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pr-8 text-lg font-semibold text-foreground sm:pr-0 sm:text-xl">
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
                  <TabsList variant="default" className="h-9 sm:h-8">
                    <TabsTrigger
                      value="visual"
                      className="px-3 py-1 text-[11px] font-medium"
                    >
                      {t("settings.appearance.visual")}
                    </TabsTrigger>
                    <TabsTrigger
                      value="json"
                      className="px-3 py-1 text-[11px] font-medium"
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
                  placeholder={!profileCompleted ? t("forms.aiPromptPlaceholderDisabled") : t("forms.aiPromptPlaceholder")}
                  generatingText={t("common.generating")}
                  className="space-y-2"
                  titleClassName="text-sm"
                  disabled={!profileCompleted}
                />
              </Field>
              <FieldSeparator />
              <form>
                <EventFormFields />
                <Field orientation="horizontal" className="mt-6">
                  <DrawerClose asChild>
                    <Button variant="outline" type="button" className="min-h-11 sm:min-h-0">
                      {t("common.cancel")}
                    </Button>
                  </DrawerClose>
                  <LoadingButton
                    type="button"
                    onMouseDown={onSubmit}
                    disabled={!eventForm.isValid}
                    isLoading={isSubmitting}
                    loadingText={t("common.pleaseWait")}
                    className="min-h-11 sm:min-h-0"
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
        <EventFormPreview className="hidden lg:flex" />
      </div>
    </EventFormProvider>
  );
}
