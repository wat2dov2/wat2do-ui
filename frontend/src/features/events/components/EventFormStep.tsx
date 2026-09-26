import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Event, Club } from "@/shared/types";
import { buildPreviewEvent } from "@/features/events/lib/previewEvent";
import { clubDirectoryQueryOptions } from "@/features/clubs";
import { useQuery } from "@tanstack/react-query";
import { useEventsStore } from "@/features/events/store/events.store";
import { ArrowLeft } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { LoadingButton } from "@/shared/ui/loading-button";
import {
  Field,
  FieldGroup,
} from "@/shared/ui/field";
import { EventFormPreview } from "@/features/events/components/EventForm/EventForm/EventFormPreview";
import { EventFormFields } from "@/features/events/components/EventForm/EventForm/EventFormFields";
import { EventFormProvider } from "@/features/events/components/EventForm/EventForm/EventFormContext";
import type { useEventForm } from "@/features/events/hooks/useEventForm";
import { getCurrentSchool } from "@/shared/constants/schools";

const NO_CLUBS: Club[] = [];

/** The subset of useEventForm's return value that EventFormStep needs. */
type EventFormHookReturn = ReturnType<typeof useEventForm>;

interface EventFormStepProps {
  isEditMode: boolean;
  canCreateEvents: boolean;
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
    | "imagePreview"
    | "imageFile"
    | "onImageUpload"
    | "onRemoveImage"
    | "isValid"
  >;
  isDarkMode: boolean;
  /** Absent when the form is an always-present panel with nothing to dismiss. */
  onBack?: () => void;
  showHeading?: boolean;
  /** The live event-card preview beside the fields. */
  showPreview?: boolean;
  /** The saved event being edited; fields the form does not own carry over. */
  previewBase?: Event | null;
  /** Lets a host render its own preview of what the form currently describes. */
  onPreviewEventChange?: (event: Event) => void;
  /** Off where the host saves the form, so there is one save button, not two. */
  showSubmit?: boolean;
}

export function EventFormStep({
  isEditMode,
  canCreateEvents,
  isSubmitting,
  onSubmit,
  eventForm,
  isDarkMode,
  onBack,
  showHeading = true,
  showPreview = true,
  previewBase,
  onPreviewEventChange,
  showSubmit = true,
}: EventFormStepProps) {
  const { t } = useTranslation();
  const schoolFilter = useEventsStore((s) => s.schoolFilter);
  const clubSchool = previewBase?.school ?? schoolFilter;

  const { data: clubs = NO_CLUBS } = useQuery({
    ...clubDirectoryQueryOptions(clubSchool),
    select: (directory) => directory.items,
  });

  const selectedClubName = useMemo(() => {
    const id = eventForm.formData.club_id;
    return id != null ? clubs.find((org) => org.id === id)?.club_name ?? "" : "";
  }, [clubs, eventForm.formData.club_id]);

  // One event, rebuilt as the form changes: the preview column and any host
  // drawing its own preview show the same card, keystroke for keystroke.
  const previewEvent = useMemo(
    () =>
      buildPreviewEvent({
        school: clubs.find((club) => club.id === eventForm.formData.club_id)?.school ?? previewBase?.school ?? getCurrentSchool(),
        formData: eventForm.formData,
        imagePreview: eventForm.imagePreview,
        clubName: selectedClubName,
        fallbackTitle: t("events.eventTitle"),
        base: previewBase,
      }),
    [
      eventForm.formData,
      clubs,
      eventForm.imagePreview,
      selectedClubName,
      previewBase,
      t,
    ],
  );

  useEffect(() => {
    onPreviewEventChange?.(previewEvent);
  }, [previewEvent, onPreviewEventChange]);

  // Memoize the context value so consumers (6 components) only re-render when
  // form state actually changes, not on every parent render.
  const formContextValue = useMemo(
    () => ({
      formData: eventForm.formData,
      previewEvent,
      updateField: eventForm.updateField,
      errors: eventForm.errors,
      touched: eventForm.touched,
      handleBlur: eventForm.handleBlur,
      clubs,
      selectedClubName,
      updateOccurrence: eventForm.updateOccurrence,
      addOccurrence: eventForm.addOccurrence,
      removeOccurrence: eventForm.removeOccurrence,
      foodInput: eventForm.foodInput,
      setFoodInput: eventForm.setFoodInput,
      addFood: eventForm.addFood,
      removeFood: eventForm.removeFood,
      imagePreview: eventForm.imagePreview,
      imageFile: eventForm.imageFile,
      isImageRequired: !isEditMode,
      onImageUpload: eventForm.onImageUpload,
      onRemoveImage: eventForm.onRemoveImage,
      isDarkMode,
    }),
    [
      eventForm,
      isDarkMode,
      isEditMode,
      clubs,
      previewEvent,
      selectedClubName,
    ]
  );

  return (
    <EventFormProvider value={formContextValue}>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-4 pt-5 sm:px-6 sm:pb-6 sm:pt-6">
          <div className="mb-5 sm:mb-7">
            <div className="flex flex-col items-end gap-3 sm:flex-row sm:justify-between sm:gap-4">
              {showHeading ? (
                <div className="flex min-h-9 min-w-0 flex-1 items-center gap-2 self-start pr-10 sm:pr-0">
                  {onBack && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      onMouseDown={onBack}
                      aria-label={t("common.back")}
                    >
                      <ArrowLeft className="size-4" />
                    </Button>
                  )}
                  <h2 className="min-w-0 text-lg font-semibold leading-none text-foreground sm:text-xl">
                    {isEditMode
                      ? t("events.updateEvent")
                      : canCreateEvents
                        ? t("events.createEvent")
                        : t("events.submitEventForReview")}
                  </h2>
                </div>
              ) : null}
            </div>
          </div>

          <FieldGroup>
            <form>
              <EventFormFields />
              {showSubmit ? (
                <Field orientation="horizontal" className="mt-6">
                  <LoadingButton
                    type="button"
                    onMouseDown={onSubmit}
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
              ) : null}
            </form>
          </FieldGroup>
        </div>

        {showPreview ? <EventFormPreview className="hidden lg:flex" /> : null}
      </div>
    </EventFormProvider>
  );
}
