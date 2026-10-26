import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
} from "react";
import { useAuthState } from "@/features/auth";
import { useTranslation } from "react-i18next";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import { ImageParseStep } from "@/shared/components/ImageParseStep";
import { useImageParse } from "@/shared/hooks/useImageParse";
import { parseEventImage } from "@/shared/services/uploadService";
import { getCurrentSchool } from "@/shared/constants/schools";
import { useEventForm } from "@/features/events/hooks/useEventForm";
import { mapEventInputToFormData } from "@/features/events/hooks/useEventForm.utils";
import {
  useSubmitEvent,
  type SubmitEventResult,
} from "@/features/events/hooks/useSubmitEvent";
import { useDarkMode } from "@/shared/hooks/useDarkMode";
import { EventFormStep } from "@/features/events/components/EventFormStep";
import { EventSuccessScreen } from "@/features/events/components/EventForm/EventForm/EventSuccessScreen";
import {
  EventFormProvider,
  type EventFormContextValue,
} from "@/features/events/components/EventForm/EventForm/EventFormContext";
import { DrawerBody, Section } from "@/shared/layout";
import { LoadingPage } from "@/shared/ui/loading-page";
import type { Event, EventFormData } from "@/shared/types";

interface SubmitEventSharedProps {
  /** Absent when the form is an always-present panel with nothing to dismiss. */
  onClose?: () => void;
  onSubmit?: (
    event: EventFormData,
    submittedByEmail: string,
  ) => SubmitEventResult | Promise<SubmitEventResult>;
  canCreateEvents: boolean;
  onBack?: () => void;
  editEventId?: number;
}

interface SubmitEventFlowProps extends SubmitEventSharedProps {
  /** Inactive embedded forms retain drafts without handling clipboard input. */
  active?: boolean;
  initialData?: EventFormData;
  onUpdate?: (
    eventId: number,
    event: EventFormData,
  ) => void | Promise<void>;
  isEditMode?: boolean;
  embedded?: boolean;
  showHeading?: boolean;
  showPreview?: boolean;
  /** The saved event being edited; fields the form does not own carry over. */
  previewBase?: Event | null;
  /** Lets a host render its own preview of what the form currently describes. */
  onPreviewEventChange?: (event: Event) => void;
  /**
   * Filled with the form's save, for a host that owns the save button itself.
   * Resolves false when the form refused to save, so the host can stop.
   */
  saveRef?: MutableRefObject<(() => Promise<boolean>) | null>;
  /** Off where the host saves the form, so there is one save button, not two. */
  showSubmit?: boolean;
}

interface SubmitEventModalProps extends SubmitEventSharedProps {
  /** The modal owns a dismissable surface, so closing is never optional here. */
  onClose: () => void;
  isOpen: boolean;
  initialData?: EventFormData;
  loadEventForEdit?: (eventId: number) => Promise<EventFormData>;
  onUpdate?: (
    eventId: number,
    event: EventFormData,
  ) => void | Promise<void>;
}

type SubmitEventStep =
  | "submit-success"
  | "image-parse"
  | "form";

const NOOP = () => undefined;

export function SubmitEventFlow({
  initialData,
  onClose,
  onSubmit,
  canCreateEvents,
  onBack,
  editEventId,
  onUpdate,
  isEditMode = false,
  embedded = false,
  showHeading = true,
  showPreview = true,
  active = true,
  previewBase,
  onPreviewEventChange,
  saveRef,
  showSubmit = true,
}: SubmitEventFlowProps) {
  const { t } = useTranslation();
  const { isDarkMode } = useDarkMode();
  const { userEmail } = useAuthState();
  const [submittedByEmail, setSubmittedByEmail] = useState(userEmail ?? "");
  const [submitResult, setSubmitResult] = useState<{
    createdEventId: number | null;
  } | null>(null);
  const [hasInitiated, setHasInitiated] = useState(isEditMode);
  const openForm = useCallback(() => setHasInitiated(true), []);
  const flyerParseCopy = useMemo(
    () => ({
      failedTitle: t("events.flyerParseFailed"),
      failedDescription: t("events.flyerParseFailedDescription"),
      extracted: t("events.flyerExtracted"),
    }),
    [t],
  );

  const eventForm = useEventForm({
    initialData,
    isEditMode,
    isOpen: true,
  });

  const parseFlyer = useCallback(
    async (file: File) => {
      const parsedData = await parseEventImage(file, getCurrentSchool());
      eventForm.setFormData((previous) =>
        mapEventInputToFormData(
          parsedData as unknown as Record<string, unknown>,
          {
            timeZone: previous.timeZone,
            occurrences: previous.occurrences,
            source_image_url: previous.source_image_url,
          },
        ),
      );
      if (parsedData.source_image_url) {
        eventForm.resetImage(parsedData.source_image_url);
      }
    },
    [eventForm],
  );

  const imageParse = useImageParse({
    active,
    copy: flyerParseCopy,
    parse: parseFlyer,
    onSettled: openForm,
  });

  const handleSubmitted = useCallback((eventId: number | null) => {
    setSubmitResult({ createdEventId: eventId });
  }, []);

  const { isSubmitting, handleSubmit: submitEvent } = useSubmitEvent({
    isEditMode,
    editEventId,
    onSubmit: onSubmit ? (data) => onSubmit(data, submittedByEmail.trim()) : undefined,
    onUpdate,
    onClose,
    onSubmitted: handleSubmitted,
  });

  const handleSubmit = useCallback(
    () =>
      submitEvent(
        eventForm.formData,
        eventForm.imageFile,
        eventForm.markAllFieldsTouched,
        eventForm.isValid,
      ),
    [
      eventForm.formData,
      eventForm.imageFile,
      eventForm.markAllFieldsTouched,
      eventForm.isValid,
      submitEvent,
    ],
  );

  // A host that owns the save button (the carousel drawer's Save draft) needs
  // to run the form's own submit, so the image upload, validation, and error
  // reporting stay in one place.
  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = () =>
      isEditMode && !eventForm.imageFile &&
      JSON.stringify(eventForm.formData) === JSON.stringify(initialData)
        ? Promise.resolve(true)
        : handleSubmit();
    return () => {
      saveRef.current = null;
    };
  }, [saveRef, handleSubmit, isEditMode, eventForm.imageFile, eventForm.formData, initialData]);

  const currentStep: SubmitEventStep = submitResult && !isEditMode
    ? "submit-success"
    : !isEditMode && !hasInitiated
      ? "image-parse"
      : "form";

  const successContext = {
    formData: eventForm.formData,
    selectedClubName: "",
  } as unknown as EventFormContextValue;

  if (currentStep === "submit-success") {
    return (
      <EventFormProvider value={successContext}>
        <EventSuccessScreen
          onClose={onClose ?? NOOP}
          isEditMode={isEditMode}
          isSubmissionOnly={submitResult?.createdEventId == null}
        />
      </EventFormProvider>
    );
  }

  if (currentStep === "image-parse") {
    return (
      <ImageParseStep
        title={t("events.uploadEventFlyer")}
        description={t("events.uploadEventFlyerDescription")}
        processingLabel={t("events.processingEventImage")}
        imageParse={imageParse}
      />
    );
  }

  return (
    <Section
      variant="surface"
      className={embedded ? "flex min-h-0 overflow-hidden p-0" : "flex min-h-[64dvh] overflow-hidden p-0"}
    >
      <EventFormStep
        isEditMode={isEditMode}
        canCreateEvents={canCreateEvents}
        isSubmitting={isSubmitting}
        submittedByEmail={submittedByEmail}
        onEmailChange={setSubmittedByEmail}
        onSubmit={handleSubmit}
        eventForm={eventForm}
        isDarkMode={isDarkMode}
        onBack={onBack}
        showHeading={showHeading}
        showPreview={showPreview}
        previewBase={previewBase}
        onPreviewEventChange={onPreviewEventChange}
        showSubmit={showSubmit}
      />
    </Section>
  );
}

interface SubmitEventModalContentProps extends SubmitEventModalProps {
  isEditMode: boolean;
}

function SubmitEventModalContent({
  isOpen,
  onClose,
  onSubmit,
  canCreateEvents,
  onBack,
  editEventId,
  initialData,
  loadEventForEdit,
  onUpdate,
  isEditMode,
}: SubmitEventModalContentProps) {
  const { t } = useTranslation();
  const [resolvedInitialData, setResolvedInitialData] = useState<
    EventFormData | undefined
  >(undefined);

  useEffect(() => {
    if (!isOpen || !editEventId || !loadEventForEdit) return;
    let cancelled = false;

    loadEventForEdit(editEventId)
      .then((data) => {
        if (!cancelled) setResolvedInitialData(data);
      })
      .catch((error) => {
        console.error("Failed to load event for edit:", error);
        if (!cancelled) setResolvedInitialData(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, editEventId, loadEventForEdit]);

  const isLoading =
    editEventId != null &&
    loadEventForEdit != null &&
    resolvedInitialData === undefined;
  const formInitialData =
    (isEditMode && (resolvedInitialData ?? initialData)) ?? initialData;
  const formKey =
    editEventId && loadEventForEdit && resolvedInitialData != null
      ? `edit-${editEventId}-ready`
      : `edit-${editEventId ?? "unknown"}`;

  return (
    <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent aria-describedby={undefined}>
        <DrawerHeader className="sr-only">
          <DrawerTitle>{t("events.updateEvent")}</DrawerTitle>
        </DrawerHeader>

        {isLoading ? (
          <DrawerBody>
            <Section title={t("events.updateEvent")}>
              <LoadingPage variant="form" />
            </Section>
          </DrawerBody>
        ) : (
          <SubmitEventFlow
            key={formKey}
            initialData={formInitialData}
            onClose={onClose}
            onSubmit={onSubmit}
            canCreateEvents={canCreateEvents}
            onBack={onBack}
            editEventId={editEventId}
            onUpdate={onUpdate}
            isEditMode={isEditMode}
            embedded
          />
        )}
      </DrawerContent>
    </Drawer>
  );
}

export function SubmitEventModal(props: SubmitEventModalProps) {
  if (!props.isOpen) return null;

  const isEditMode =
    props.editEventId != null &&
    (props.initialData != null || props.loadEventForEdit != null);
  const formKey = props.editEventId
    ? `edit-${props.editEventId}`
    : "edit-unknown";

  return (
    <SubmitEventModalContent
      key={formKey}
      {...props}
      isEditMode={isEditMode}
    />
  );
}
