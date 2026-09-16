import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import { ImageUploadField } from "@/shared/ui/image-upload-field";
import { parseEventImage } from "@/shared/services/uploadService";
import { getCurrentSchool } from "@/shared/constants/schools";
import { toast } from "@/shared/hooks/use-toast";
import { useEventForm } from "@/features/events/hooks/useEventForm";
import { mapEventInputToFormData } from "@/features/events/hooks/useEventForm.utils";
import {
  useSubmitEvent,
  type SubmitEventResult,
} from "@/features/events/hooks/useSubmitEvent";
import { useDarkMode } from "@/shared/hooks/useDarkMode";
import { controlBox } from "@/shared/config/controlBox";
import { EventFormStep } from "@/features/events/components/EventFormStep";
import { EventSuccessScreen } from "@/features/events/components/EventForm/EventForm/EventSuccessScreen";
import {
  EventFormProvider,
  type EventFormContextValue,
} from "@/features/events/components/EventForm/EventForm/EventFormContext";
import { Section, Stack } from "@/shared/layout";
import type { Event, EventFormData } from "@/shared/types";

// The picker, the paste handler, and the server all read the same control-box
// contract, so a file the browser lets through is one the server will accept.
const EVENT_IMAGE_ALLOWED_MIME_TYPES =
  controlBox.uploads.eventImageAllowedMimeTypes;
const EVENT_IMAGE_MAX_SIZE_BYTES = controlBox.uploads.eventImageMaxSizeBytes;
const EVENT_IMAGE_ACCEPT = EVENT_IMAGE_ALLOWED_MIME_TYPES.join(",");

const isAllowedEventImageType = (type: string): boolean =>
  (EVENT_IMAGE_ALLOWED_MIME_TYPES as readonly string[]).includes(type);

interface SubmitEventSharedProps {
  /** Absent when the form is an always-present panel with nothing to dismiss. */
  onClose?: () => void;
  onSubmit?: (
    event: EventFormData,
  ) => SubmitEventResult | Promise<SubmitEventResult>;
  canCreateEvents: boolean;
  onBack?: () => void;
  editEventId?: number;
}

interface SubmitEventFlowProps extends SubmitEventSharedProps {
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
  previewBase,
  onPreviewEventChange,
  saveRef,
  showSubmit = true,
}: SubmitEventFlowProps) {
  const { t } = useTranslation();
  const { isDarkMode } = useDarkMode();
  const [submitResult, setSubmitResult] = useState<{
    createdEventId: number | null;
  } | null>(null);
  const [hasInitiated, setHasInitiated] = useState(isEditMode);
  const [isParsingImage, setIsParsingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const eventForm = useEventForm({
    initialData,
    isEditMode,
    isOpen: true,
  });

  const handleImageFileParse = useCallback(
    async (file: File) => {
      if (!isAllowedEventImageType(file.type)) {
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        toast({
          title: t("events.flyerParseFailed"),
          description: t("events.flyerTypeError"),
          variant: "destructive",
        });
        return;
      }

      if (file.size > EVENT_IMAGE_MAX_SIZE_BYTES) {
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        toast({
          title: t("events.flyerParseFailed"),
          description: t("qrCode.imageSizeError"),
          variant: "destructive",
        });
        return;
      }

      setIsParsingImage(true);
      try {
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
          eventForm.setImagePreview(parsedData.source_image_url);
        }

        toast({
          title: t("common.success"),
          description: t("events.flyerExtracted"),
        });
        setHasInitiated(true);
      } catch (error) {
        console.error("AI image parse error:", error);
        setHasInitiated(true);
        toast({
          title: t("events.flyerParseFailed"),
          description:
            error instanceof Error
              ? error.message
              : t("events.flyerParseFailedDescription"),
          variant: "destructive",
        });
      } finally {
        setIsParsingImage(false);
      }
    },
    [eventForm, t],
  );

  const handleImageParseSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      await handleImageFileParse(file);
    },
    [handleImageFileParse],
  );

  useEffect(() => {
    if (isParsingImage) return;

    const handlePaste = async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (!isAllowedEventImageType(item.type)) continue;
        const file = item.getAsFile();
        if (!file) continue;
        event.preventDefault();
        await handleImageFileParse(file);
        break;
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [isParsingImage, handleImageFileParse]);

  const handleSubmitted = useCallback((eventId: number | null) => {
    setSubmitResult({ createdEventId: eventId });
  }, []);

  const { isSubmitting, handleSubmit: submitEvent } = useSubmitEvent({
    isEditMode,
    editEventId,
    onSubmit,
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
      <Section variant="surface" className="mx-auto w-full max-w-2xl">
        <Stack align="center" gap={4}>
          <Stack align="center" gap={1} className="text-center">
            <h2 className="text-lg font-semibold text-foreground">
              {t("events.uploadEventFlyer")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("events.uploadEventFlyerDescription")}
            </p>
          </Stack>

          {isParsingImage ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-secondary/30 py-8">
              <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm font-medium text-foreground">
                {t("events.processingEventImage")}
              </p>
            </div>
          ) : (
            <div className="w-full">
              <ImageUploadField
                fileInputRef={fileInputRef}
                label={t("events.clickToUploadOrPasteImage")}
                accept={EVENT_IMAGE_ACCEPT}
                onImageUpload={handleImageParseSelect}
              />
            </div>
          )}
        </Stack>
      </Section>
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
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            {t("common.loading")}
          </div>
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
