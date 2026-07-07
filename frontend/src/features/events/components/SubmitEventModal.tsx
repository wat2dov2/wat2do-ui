import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { useEventFormAI } from "@/features/events/hooks/useEventFormAI";
import { useEventFormPromotion } from "@/features/events/hooks/useEventFormPromotion";
import { useSubmitEvent, type SubmitEventResult } from "@/features/events/hooks/useSubmitEvent";
import { useDarkMode } from "@/shared/hooks/useDarkMode";
import { useModalState } from "@/shared/hooks/useModalState";
import { EventFormStep, type ViewMode } from "@/features/events/components/EventFormStep";
import { SubmitSuccessStep } from "@/features/events/components/SubmitSuccessStep";
import { PromotionUpsell } from "@/features/events/components/EventForm/EventForm/PromotionUpsell";
import { PromotionSuccessScreen } from "@/features/events/components/EventForm/EventForm/PromotionSuccessScreen";
import { EventFormProvider, type EventFormContextValue } from "@/features/events/components/EventForm/EventForm/EventFormContext";
import type { EventFormData } from "@/shared/types";

interface SubmitEventModalSharedProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (event: EventFormData) => SubmitEventResult | Promise<SubmitEventResult>;
  canCreateEvents: boolean;
  onPromote?: (eventId: number) => Promise<boolean>;
  onBuyCredits?: () => void;
  onBack?: () => void;
  editEventId?: number;
}

interface SubmitEventModalProps extends SubmitEventModalSharedProps {
  userCredits?: number;
  initialData?: EventFormData;
  /** When provided, fetches event by id when opening for edit so the form is populated from the server. */
  loadEventForEdit?: (eventId: number) => Promise<EventFormData>;
  onUpdate?: (eventId: number, event: EventFormData) => void | Promise<void>;
}

interface SubmitEventModalFormBodyProps extends SubmitEventModalSharedProps {
  formInitialData: EventFormData | undefined;
  userCredits: number;
  onUpdate?: (eventId: number, event: EventFormData) => void | Promise<void>;
  isEditMode: boolean;
}



/** Form body: mounts with formInitialData so edit form is always populated when opened from admin. */
function SubmitEventModalFormBody({
  formInitialData,
  isOpen,
  onClose,
  onSubmit,
  canCreateEvents,
  userCredits,
  onPromote,
  onBuyCredits,
  onBack,
  editEventId,
  onUpdate,
  isEditMode,
}: SubmitEventModalFormBodyProps) {
  const { t } = useTranslation();
  const { isDarkMode } = useDarkMode();
  const [viewMode, setViewMode] = useState<ViewMode>("visual");
  const [submitResult, setSubmitResult] = useState<{ createdEventId: number | null } | null>(null);
  const [hasInitiated, setHasInitiated] = useState(false);
  const [isParsingImage, setIsParsingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const eventForm = useEventForm({
    initialData: formInitialData,
    isEditMode,
    isOpen,
  });

  const handleImageFileParse = useCallback(
    async (file: File) => {
      setIsParsingImage(true);
      try {
        const parsedData = await parseEventImage(file);

        // Prefill form details
        eventForm.setFormData((prev) => ({
          ...prev,
          ...parsedData,
        }));

        if (parsedData.source_image_url) {
          eventForm.setImagePreview(parsedData.source_image_url);
        }

        toast({
          title: t("common.success") || "Success",
          description: "Flyer details extracted successfully!",
        });

        setHasInitiated(true);
      } catch (err) {
        console.error("AI image parse error:", err);
        toast({
          title: "AI Parsing Failed",
          description: err instanceof Error ? err.message : "Could not read event details from the flyer.",
          variant: "destructive",
        });
      } finally {
        setIsParsingImage(false);
      }
    },
    [eventForm, t]
  );

  const handleImageParseSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await handleImageFileParse(file);
    },
    [handleImageFileParse]
  );

  useEffect(() => {
    if (!isOpen || isParsingImage) return;

    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf("image") !== -1) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            await handleImageFileParse(file);
            break;
          }
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [isOpen, isParsingImage, handleImageFileParse]);

  const eventFormAI = useEventFormAI({
    formData: eventForm.formData,
    setFormData: eventForm.setFormData,
    setJsonValue: eventForm.setJsonValue,
    setJsonError: eventForm.setJsonError,
  });

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

  const resetState = useCallback(() => {
    setViewMode("visual");
    setSubmitResult(null);
    eventFormPromotion.setPromotionSuccess(false);
    eventFormPromotion.setShowPromotion(false);
    setHasInitiated(false);
  }, [eventFormPromotion]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const modalState = useModalState({
    onClose: handleClose,
    resetOnClose: true,
    resetFn: resetState,
  });

  const handleViewModeChange = useCallback(
    (value: ViewMode) => {
      setViewMode(value);
      if (value === "json") {
        eventForm.syncToJSON();
      }
    },
    [eventForm]
  );

  const handleSubmit = useCallback(() => {
    return submitEvent(eventForm.formData, eventForm.imageFile, eventForm.markAllFieldsTouched, eventForm.isValid);
  }, [
    eventForm.formData,
    eventForm.imageFile,
    eventForm.markAllFieldsTouched,
    eventForm.isValid,
    submitEvent,
  ]);

  // Step dispatcher: determine which step to render based on state
  type SubmitEventStep = "promotion-success" | "promotion-upsell" | "submit-success" | "image-parse" | "form";
  const currentStep: SubmitEventStep = eventFormPromotion.promotionSuccess
    ? "promotion-success"
    : eventFormPromotion.showPromotion
      ? "promotion-upsell"
      : submitResult && !isEditMode
        ? "submit-success"
        : !isEditMode && !hasInitiated
          ? "image-parse"
          : "form";

  const stepRenderers: Record<SubmitEventStep, () => React.ReactElement> = {
    "promotion-success": () => (
      <EventFormProvider value={{ formData: eventForm.formData } as unknown as EventFormContextValue}>
        <PromotionSuccessScreen
          isOpen={isOpen}
          onClose={handleClose}
        />
      </EventFormProvider>
    ),
    "promotion-upsell": () => (
      <EventFormProvider value={{ formData: eventForm.formData } as unknown as EventFormContextValue}>
        <PromotionUpsell
          isOpen={isOpen}
          onClose={handleClose}
          onPromote={eventFormPromotion.handlePromote}
          onBuyCredits={onBuyCredits || (() => {})}
          userCredits={userCredits}
        />
      </EventFormProvider>
    ),
    "submit-success": () => (
      <EventFormProvider value={{ formData: eventForm.formData, selectedClubName: "" } as unknown as EventFormContextValue}>
        <SubmitSuccessStep
          isOpen={isOpen}
          onClose={handleClose}
          onPromote={
            onPromote && submitResult?.createdEventId != null
               ? () => eventFormPromotion.setShowPromotion(true)
               : undefined
          }
          isEditMode={isEditMode}
          isSubmissionOnly={submitResult?.createdEventId == null}
        />
      </EventFormProvider>
    ),
    "image-parse": () => (
      <Drawer open={isOpen} onOpenChange={modalState.handleOpenChange}>
        <DrawerContent
          className="flex flex-col h-auto max-h-[85dvh] overflow-hidden p-6 outline-none focus:outline-none focus-visible:outline-none"
          aria-describedby={undefined}
        >
          <DrawerClose asChild>
            <button
              type="button"
              className="absolute right-3 top-3 z-20 flex size-9 items-center justify-center rounded-xl text-foreground opacity-80 transition-opacity hover:bg-muted/60 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              aria-label={t("common.close")}
            >
              <X className="size-4" />
            </button>
          </DrawerClose>
          <DrawerHeader className="px-0 pt-0 pb-1">
            <DrawerTitle className="text-xl font-bold">
              {t("events.submitEventForReview")}
            </DrawerTitle>
          </DrawerHeader>
          <div className="flex flex-col items-center max-w-md mx-auto w-full gap-4 pb-2">
            <div className="text-center space-y-1 mt-2">
              <h2 className="text-base font-bold text-foreground">
                {t("events.uploadEventFlyer")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("events.uploadEventFlyerDescription")}
              </p>
            </div>

            {isParsingImage ? (
              <div className="flex flex-col items-center justify-center gap-3 py-8 w-full bg-secondary/30 rounded-xl border-2 border-dashed border-border aspect-video">
                <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <p className="text-xs font-medium text-foreground">
                  {t("events.readingFlyerDetails")}
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
                  onMouseDown={() => fileInputRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center gap-3 rounded-xl bg-secondary px-4 py-8 text-center text-secondary-foreground shadow-xs transition-[color,box-shadow] outline-none hover:bg-secondary/80 focus-visible:ring-[3px] focus-visible:ring-ring/50 cursor-pointer border-2 border-dashed border-border/80"
                >
                  <ImagePlus className="size-8 text-muted-foreground mb-0.5" />
                  <p className="text-sm font-semibold text-foreground">
                    {t("events.clickToUploadOrPasteImage")}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {t("events.imagePasteShortcutHint", { formats: t("qrCode.imageFormat") })}
                  </p>
                </button>
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    ),
    "form": () => (
      <>
        <Drawer open={isOpen} onOpenChange={modalState.handleOpenChange}>
          <DrawerContent
            className="flex h-[92dvh] overflow-hidden p-0 outline-none focus:outline-none focus-visible:outline-none"
            aria-describedby={undefined}
          >
            <DrawerClose asChild>
              <button
                type="button"
                className="absolute right-3 top-3 z-20 flex size-9 items-center justify-center rounded-xl text-foreground opacity-80 transition-opacity hover:bg-muted/60 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                aria-label={t("common.close")}
              >
                <X className="size-4" />
              </button>
            </DrawerClose>
            <DrawerHeader className="sr-only">
              <DrawerTitle>
                {isEditMode
                  ? t("events.updateEvent")
                  : canCreateEvents
                    ? t("events.createEvent")
                    : t("events.submitEventForReview")}
              </DrawerTitle>
            </DrawerHeader>
            <EventFormStep
              isEditMode={isEditMode}
              canCreateEvents={canCreateEvents}
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
              isSubmitting={isSubmitting}
              onSubmit={handleSubmit}
              eventForm={eventForm}
              eventFormAI={eventFormAI}
              isDarkMode={isDarkMode}
              onBack={onBack}
            />
          </DrawerContent>
        </Drawer>
      </>
    ),
  };

  return stepRenderers[currentStep]();
}

interface SubmitEventModalContentProps extends SubmitEventModalSharedProps {
  userCredits: number;
  initialData?: EventFormData;
  loadEventForEdit?: (eventId: number) => Promise<EventFormData>;
  onUpdate?: (eventId: number, event: EventFormData) => void | Promise<void>;
  isEditMode: boolean;
}

function SubmitEventModalContent({
  isOpen,
  onClose,
  onSubmit,
  canCreateEvents,
  userCredits,
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
      <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DrawerContent className="overflow-hidden p-0" aria-describedby={undefined}>
          <DrawerClose asChild>
            <button
              type="button"
              className="absolute right-3 top-3 z-20 flex size-9 items-center justify-center rounded-xl text-foreground opacity-80 transition-opacity hover:bg-muted/60 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              aria-label={t("common.close")}
            >
              <X className="size-4" />
            </button>
          </DrawerClose>
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            {t("common.loading")}
          </div>
        </DrawerContent>
      </Drawer>
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
      canCreateEvents={canCreateEvents}
      userCredits={userCredits}
      onPromote={onPromote}
      onBuyCredits={onBuyCredits}
      onBack={onBack}
      editEventId={editEventId}
      onUpdate={onUpdate}
      isEditMode={isEditMode}
    />
  );
}

export function SubmitEventModal(props: SubmitEventModalProps) {
  const isEditMode = !!props.editEventId && (!!props.initialData || !!props.loadEventForEdit);
  // Remount form when switching to a different event so initialData is applied
  const formKey = props.isOpen ? (props.editEventId ? `edit-${props.editEventId}` : "create") : "closed";

  return (
    <SubmitEventModalContent
      key={formKey}
      {...props}
      userCredits={props.userCredits ?? 0}
      isEditMode={isEditMode}
    />
  );
}
