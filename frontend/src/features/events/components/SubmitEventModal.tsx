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
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import { X, ImagePlus } from "@/shared/ui/doodle-icons";
import { parseEventImage } from "@/shared/services/uploadService";
import { toast } from "@/shared/hooks/use-toast";
import { useEventForm } from "@/features/events/hooks/useEventForm";
import { mapEventInputToFormData } from "@/features/events/hooks/useEventForm.utils";
import { useEventFormPromotion } from "@/features/events/hooks/useEventFormPromotion";
import {
  useSubmitEvent,
  type SubmitEventResult,
} from "@/features/events/hooks/useSubmitEvent";
import { useDarkMode } from "@/shared/hooks/useDarkMode";
import { MAX_IMAGE_UPLOAD_SIZE_BYTES } from "@/shared/constants/uploads";
import {
  EventFormStep,
  type ViewMode,
} from "@/features/events/components/EventFormStep";
import { SubmitSuccessStep } from "@/features/events/components/SubmitSuccessStep";
import { PromotionUpsell } from "@/features/events/components/EventForm/EventForm/PromotionUpsell";
import { PromotionSuccessScreen } from "@/features/events/components/EventForm/EventForm/PromotionSuccessScreen";
import {
  EventFormProvider,
  type EventFormContextValue,
} from "@/features/events/components/EventForm/EventForm/EventFormContext";
import { Section, Stack } from "@/shared/layout";
import { cn } from "@/shared/lib/utils";
import type { Event, EventFormData } from "@/shared/types";

interface SubmitEventSharedProps {
  /** Absent when the form is an always-present panel with nothing to dismiss. */
  onClose?: () => void;
  onSubmit?: (
    event: EventFormData,
  ) => SubmitEventResult | Promise<SubmitEventResult>;
  canCreateEvents: boolean;
  onPromote?: (eventId: number) => Promise<boolean>;
  onBuyCredits?: () => void;
  onBack?: () => void;
  editEventId?: number;
}

interface SubmitEventFlowProps extends SubmitEventSharedProps {
  initialData?: EventFormData;
  userCredits?: number;
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
  userCredits?: number;
  initialData?: EventFormData;
  loadEventForEdit?: (eventId: number) => Promise<EventFormData>;
  onUpdate?: (
    eventId: number,
    event: EventFormData,
  ) => void | Promise<void>;
}

type SubmitEventStep =
  | "promotion-success"
  | "promotion-upsell"
  | "submit-success"
  | "image-parse"
  | "form";

const NOOP = () => undefined;

export function SubmitEventFlow({
  initialData,
  onClose,
  onSubmit,
  canCreateEvents,
  userCredits = 0,
  onPromote,
  onBuyCredits,
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
  const [viewMode, setViewMode] = useState<ViewMode>("visual");
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
      if (file.size > MAX_IMAGE_UPLOAD_SIZE_BYTES) {
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
        const parsedData = await parseEventImage(file);
        eventForm.setFormData((previous) =>
          mapEventInputToFormData(
            parsedData as unknown as Record<string, unknown>,
            {
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
        if (!item.type.startsWith("image/")) continue;
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

  const eventFormPromotion = useEventFormPromotion({
    createdEventId: submitResult?.createdEventId ?? null,
    onPromote,
  });

  const handleSubmitted = useCallback((eventId: number | null) => {
    setSubmitResult({ createdEventId: eventId });
  }, []);

  const { isSubmitting, handleSubmit: submitEvent } = useSubmitEvent({
    isEditMode,
    editEventId,
    onSubmit,
    onUpdate,
    onClose,
    showPromotion: eventFormPromotion.showPromotion,
    onSubmitted: handleSubmitted,
  });

  const handleViewModeChange = useCallback(
    (value: ViewMode) => {
      setViewMode(value);
      if (value === "json") {
        eventForm.syncToJSON();
      }
    },
    [eventForm],
  );

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
    saveRef.current = handleSubmit;
    return () => {
      saveRef.current = null;
    };
  }, [saveRef, handleSubmit]);

  const currentStep: SubmitEventStep = eventFormPromotion.promotionSuccess
    ? "promotion-success"
    : eventFormPromotion.showPromotion
      ? "promotion-upsell"
      : submitResult && !isEditMode
        ? "submit-success"
        : !isEditMode && !hasInitiated
          ? "image-parse"
          : "form";

  const successContext = {
    formData: eventForm.formData,
    selectedOrganizationName: "",
  } as unknown as EventFormContextValue;

  if (currentStep === "promotion-success") {
    return (
      <EventFormProvider value={successContext}>
        <PromotionSuccessScreen onClose={onClose ?? NOOP} />
      </EventFormProvider>
    );
  }

  if (currentStep === "promotion-upsell") {
    return (
      <EventFormProvider value={successContext}>
        <PromotionUpsell
          onClose={onClose ?? NOOP}
          onPromote={eventFormPromotion.handlePromote}
          onBuyCredits={onBuyCredits ?? NOOP}
          userCredits={userCredits}
        />
      </EventFormProvider>
    );
  }

  if (currentStep === "submit-success") {
    return (
      <EventFormProvider value={successContext}>
        <SubmitSuccessStep
          onClose={onClose ?? NOOP}
          onPromote={
            onPromote && submitResult?.createdEventId != null
              ? () => eventFormPromotion.setShowPromotion(true)
              : undefined
          }
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
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageParseSelect}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border/80 bg-secondary px-4 py-8 text-center text-secondary-foreground shadow-xs outline-none transition-[color,box-shadow] hover:bg-secondary-hover focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <ImagePlus className="mb-0.5 size-8 text-muted-foreground" />
                <p className="text-sm font-semibold text-foreground">
                  {t("events.clickToUploadOrPasteImage")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("events.imagePasteShortcutHint", {
                    formats: t("qrCode.imageFormat"),
                  })}
                </p>
              </button>
            </div>
          )}
        </Stack>
      </Section>
    );
  }

  return (
    <Section
      variant="surface"
      className={cn(
        "flex min-h-[64dvh] overflow-hidden p-0",
        embedded && "min-h-0 flex-1 rounded-none border-0",
      )}
    >
      <EventFormStep
        isEditMode={isEditMode}
        canCreateEvents={canCreateEvents}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        isSubmitting={isSubmitting}
        onSubmit={handleSubmit}
        eventForm={eventForm}
        isDarkMode={isDarkMode}
        onCancel={onClose}
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
  userCredits = 0,
  onPromote,
  onBuyCredits,
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
        <DrawerClose asChild>
          <button
            type="button"
            className="absolute right-3 top-3 z-20 flex size-9 items-center justify-center rounded-xl text-foreground opacity-80 transition-opacity hover:bg-muted-hover hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label={t("common.close")}
          >
            <X className="size-4" />
          </button>
        </DrawerClose>
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
            userCredits={userCredits}
            onPromote={onPromote}
            onBuyCredits={onBuyCredits}
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
