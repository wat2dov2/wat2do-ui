import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { LoadingButton } from "@/shared/ui/loading-button";
import { Textarea } from "@/shared/ui/textarea";
import { Label } from "@/shared/ui/label";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import { DrawerBody, FormGrid, Stack } from "@/shared/layout";
import { toast } from "@/shared/hooks/use-toast";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import { queryKeys } from "@/shared/lib/queryKeys";
import { controlBox } from "@/shared/config/controlBox";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { getSchoolColors } from "@/shared/lib/schoolBranding";
import { SubmitEventFlow } from "@/features/events/components/SubmitEventModal";
import { fetchEventById, updateEventAPI } from "@/features/events/api/events.api";
import { eventToFormData, getEventCategory } from "@/shared/utils/event";
import type { ApiInstagramPublishBatchResponse } from "@/shared/generated";
import type { Event, EventFormData } from "@/shared/types";
import {
  carouselEventIds,
  carouselSlideEvents,
  isBatchEditable,
  publishedCarouselAssets,
} from "@/features/admin/lib/instagramCarousel";
import { CarouselSlidePreview } from "@/features/admin/components/instagram/CarouselSlidePreview";
import { defaultCoverBody } from "@/features/admin/lib/instagramSlides";

type Batch = ApiInstagramPublishBatchResponse;

interface InstagramCarouselDrawerProps {
  /** Mount with `key={batch.id}` so a different run starts from its own state. */
  batch: Batch;
  isSaving: boolean;
  isPublishing: boolean;
  onClose: () => void;
  onSaveDraft: (draft: {
    coverBody: string;
    captionIntro: string;
    eventIds: number[];
  }) => Promise<Batch>;
  onPublish: (version: number) => Promise<void>;
}

/** The cover is slide 0; event slides follow in carousel order. */
const COVER_INDEX = 0;

export function InstagramCarouselDrawer({
  batch,
  isSaving,
  isPublishing,
  onClose,
  onSaveDraft,
  onPublish,
}: InstagramCarouselDrawerProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { schoolBySlug } = useSchoolDirectory();
  const [eventIds, setEventIds] = useState<number[]>(() => carouselEventIds(batch));
  const caption = batch.caption;
  const [captionIntro, setCaptionIntro] = useState(batch.caption_intro);
  const [coverBody, setCoverBody] = useState(batch.cover_body);
  const [slideIndex, setSlideIndex] = useState(COVER_INDEX);
  const [addingEvent, setAddingEvent] = useState(false);
  const [eventIdInput, setEventIdInput] = useState("");
  /** The open slide's event is saved before the run, and takes its own moment. */
  const [isSavingSlide, setIsSavingSlide] = useState(false);

  const editable = isBatchEditable(batch);
  const savedIntro = batch.caption_intro.trim();
  const generatedCaption = savedIntro && caption.startsWith(`${savedIntro}\n\n`)
    ? caption.slice(savedIntro.length + 2)
    : caption === savedIntro ? "" : caption;
  const displayedCaption = editable ? generatedCaption : caption;
  const captionLength = editable
    ? [captionIntro.trim(), generatedCaption].filter(Boolean).join("\n\n").length
    : caption.length;
  const slideCount = eventIds.length + 1;
  const currentEventId = slideIndex === COVER_INDEX ? null : (eventIds[slideIndex - 1] ?? null);
  const busy = isSaving || isPublishing || isSavingSlide;
  const school = schoolBySlug.get(batch.school);
  const coverColors = school ? getSchoolColors(school) : null;

  // Slides render from the saved carousel, so an event edited here shows up in
  // the preview once the draft is saved and the batch comes back.
  const slideEvents = useMemo(() => carouselSlideEvents(batch), [batch]);
  // A published run shows the PNGs Instagram was given, not a fresh render of
  // events that have moved on since. Slide 0 is the cover.
  const publishedAssets = useMemo(() => publishedCarouselAssets(batch), [batch]);
  const coverTiles = useMemo(
    () =>
      eventIds
        .map((eventId) => slideEvents[eventId]?.source_image_url ?? "")
        .filter((url) => url.length > 0),
    [eventIds, slideEvents],
  );

  // Landing on a slide populates the form with that event's details.
  const { data: currentEvent } = useQuery({
    queryKey: queryKeys.events.detail(currentEventId ?? 0),
    queryFn: () => fetchEventById(currentEventId as number),
    enabled: currentEventId != null,
    staleTime: controlBox.clientCache.liveEventDataStaleMs,
  });
  const editForm = useMemo(
    () =>
      currentEvent && currentEvent.id === currentEventId
        ? eventToFormData({ ...currentEvent, category: getEventCategory(currentEvent) })
        : null,
    [currentEvent, currentEventId],
  );

  // The slide is whatever the open form currently says, keystroke for
  // keystroke - it is the same card either way, just fed from the form instead
  // of the server until the edit is saved. Tagged with its event so a slide
  // never shows the one before it.
  const [liveSlide, setLiveSlide] = useState<{ eventId: number; event: Event } | null>(null);
  /** The open slide form's save, so this drawer's save covers it too. */
  const slideSaveRef = useRef<(() => Promise<boolean>) | null>(null);
  const handlePreviewEventChange = useCallback(
    (event: Event) => {
      if (currentEventId == null) return;
      setLiveSlide({ eventId: currentEventId, event });
    },
    [currentEventId],
  );

  const savedSlideEvent = currentEventId == null ? null : (slideEvents[currentEventId] ?? null);
  const previewedSlideEvent =
    liveSlide && liveSlide.eventId === currentEventId ? liveSlide.event : savedSlideEvent;

  /** Saves the carousel the editor is holding, with the given slides on it. */
  const persistDraft = useCallback(
    (slideEventIds: number[]) =>
      onSaveDraft({ coverBody, captionIntro, eventIds: slideEventIds }),
    [coverBody, captionIntro, onSaveDraft],
  );

  const handleUpdateEvent = useCallback(
    async (eventId: number, data: EventFormData) => {
      await updateEventAPI(eventId, data);
      // The batch carries its slides' event data, so an edited slide is stale
      // there too until the run is refetched.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.events.detail(eventId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.instagramPublishing.all }),
      ]);
      // The form reports the event it saved; this drawer reports the run.
    },
    [queryClient],
  );

  const parsedEventId = Number(eventIdInput);
  const canAddEventId =
    Number.isSafeInteger(parsedEventId) &&
    parsedEventId > 0 &&
    !eventIds.includes(parsedEventId);

  /** Adds an existing event to this carousel and saves the new order immediately. */
  const handleAddEventId = useCallback(
    async () => {
      if (!canAddEventId) return;

      const saved = await persistDraft([...eventIds, parsedEventId]);
      const savedEventIds = carouselEventIds(saved);
      setEventIds(savedEventIds);
      setSlideIndex(savedEventIds.indexOf(parsedEventId) + 1);
      setAddingEvent(false);
      setEventIdInput("");
    },
    [canAddEventId, eventIds, parsedEventId, persistDraft],
  );

  const addEventId = useCallback(() => {
    handleAddEventId().catch((error) => {
      toast({
        title: t("admin.instagramPublishing.addEventError"),
        description: getApiErrorMessage(error),
        variant: "destructive",
      });
    });
  }, [handleAddEventId, t]);

  /** Takes the event off this carousel. The event itself is untouched. */
  const handleRemoveSlide = useCallback(async (removedEventId: number) => {
    if (!editable || busy || eventIds.length <= 1) return;
    const previousIndex = slideIndex;
    const next = eventIds.filter((eventId) => eventId !== removedEventId);
    setEventIds(next);
    setSlideIndex(currentEventId == null || currentEventId === removedEventId ? COVER_INDEX : next.indexOf(currentEventId) + 1);
    setIsSavingSlide(true);
    try {
      const saved = await persistDraft(next);
      setEventIds(carouselEventIds(saved));
    } catch (error) {
      setEventIds(eventIds);
      setSlideIndex(previousIndex);
      toast({ title: t("admin.instagramPublishing.saveError"), description: getApiErrorMessage(error), variant: "destructive" });
    } finally {
      setIsSavingSlide(false);
    }
  }, [currentEventId, eventIds, persistDraft, t, editable, busy, slideIndex]);

  /**
   * Saves everything the editor is holding: the open slide's event, then the
   * carousel itself.
   *
   * The event form has no save button of its own here - one screen, one save -
   * so a slide edited and left on screen is part of this draft. A form that
   * refuses to save (missing a required field) stops the whole save, with its
   * own errors already on screen.
   */
  const handleSaveDraft = useCallback(async (nextEventIds = eventIds) => {
    const saveSlideEdit = slideSaveRef.current;
    if (saveSlideEdit) {
      setIsSavingSlide(true);
      try {
        if (!(await saveSlideEdit())) return null;
      } finally {
        setIsSavingSlide(false);
      }
    }

    const saved = await persistDraft(nextEventIds);
    setEventIds(carouselEventIds(saved));
    return saved;
  }, [eventIds, persistDraft]);

  const saveDraft = useCallback(() => {
    handleSaveDraft().catch((error) => {
      toast({
        title: t("admin.instagramPublishing.saveError"),
        description: getApiErrorMessage(error),
        variant: "destructive",
      });
    });
  }, [handleSaveDraft, t]);

  const publish = useCallback(() => {
    handleSaveDraft()
      .then((saved) => (saved ? onPublish(saved.version) : undefined))
      .catch((error) => {
        toast({
          title: t("admin.instagramPublishing.publishError"),
          description: getApiErrorMessage(error),
          variant: "destructive",
        });
      });
  }, [handleSaveDraft, onPublish, t]);

  const canSave = editable && !busy && eventIds.length > 0 && caption.trim().length > 0;

  const startAddingEvent = async () => {
    if (busy || addingEvent) return;
    setIsSavingSlide(true);
    try {
      if (slideSaveRef.current && !(await slideSaveRef.current())) return;
      setAddingEvent(true);
    } catch (error) {
      toast({ title: t("admin.instagramPublishing.saveError"), description: getApiErrorMessage(error), variant: "destructive" });
    } finally {
      setIsSavingSlide(false);
    }
  };

  const selectSlide = async (index: number) => {
    if (busy || index === slideIndex) return;
    try {
      if (editable) {
        setIsSavingSlide(true);
        if (slideSaveRef.current && !(await slideSaveRef.current())) return;
        if (coverBody !== batch.cover_body) await persistDraft(eventIds);
      }
      setAddingEvent(false);
      setSlideIndex(index);
    } catch (error) {
      toast({ title: t("admin.instagramPublishing.saveError"), description: getApiErrorMessage(error), variant: "destructive" });
    } finally {
      setIsSavingSlide(false);
    }
  };

  const reorderSlide = async (sourceId: number, position: number) => {
    if (!editable || busy || !Number.isSafeInteger(position) || position < 1 || position > eventIds.length || !eventIds.includes(sourceId)) return;
    const next = eventIds.filter((id) => id !== sourceId);
    next.splice(position - 1, 0, sourceId);
    try {
      if (!(await handleSaveDraft(next))) return;
      setSlideIndex(currentEventId == null ? COVER_INDEX : next.indexOf(currentEventId) + 1);
    } catch (error) {
      toast({ title: t("admin.instagramPublishing.saveError"), description: getApiErrorMessage(error), variant: "destructive" });
    }
  };

  return (
    <Drawer open onOpenChange={(open) => !open && !busy && onClose()}>
      <DrawerContent size="wide">
        <DrawerHeader>
          <Stack gap={1}>
            <DrawerTitle>{batch.school}</DrawerTitle>
            <DrawerDescription>{batch.local_date}</DrawerDescription>
          </Stack>
        </DrawerHeader>

        <DrawerBody scroll="columns">
          <FormGrid columns="split">
            <FormGrid columns="gallery">
              {[null, ...eventIds].map((eventId, index) => (
              <CarouselSlidePreview
                key={eventId ?? "cover"}
                selected={slideIndex === index}
                onSelect={() => void selectSlide(index)}
                disabled={busy}
                removeDisabled={eventIds.length <= 1}
                onRemove={editable && eventId != null ? () => void handleRemoveSlide(eventId) : undefined}
                onPositionChange={editable && eventId != null ? (position) => void reorderSlide(eventId, position) : undefined}
                slideIndex={index}
                slideCount={slideCount}
                event={eventId === currentEventId ? previewedSlideEvent : eventId == null ? null : slideEvents[eventId] ?? null}
                coverColors={coverColors}
                cover={{
                  language: school?.language ?? "en",
                  school: batch.school,
                  localDate: batch.local_date,
                  newEventCount: batch.new_event_count,
                  eventCount: eventIds.length,
                  body: coverBody,
                  tiles: coverTiles,
                }}
                publishedAssetUrl={publishedAssets[index] ?? null}
              />
              ))}
            </FormGrid>
            <Stack gap={6}>
            {/*
              A published run is a record, so it has no editing surface at all -
              the slides above are the images that were posted, and the caption
              below reads back what went with them.
            */}
            {!editable ? null : addingEvent ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    addEventId();
                  }}
                >
                  <Stack gap={4}>
                    <Stack gap={2}>
                      <Label htmlFor="instagram-event-id">
                        {t("admin.instagramPublishing.eventId")}
                      </Label>
                      <Input
                        id="instagram-event-id"
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        autoFocus
                        value={eventIdInput}
                        disabled={busy}
                        placeholder={t("admin.instagramPublishing.eventIdPlaceholder")}
                        onChange={(event) => setEventIdInput(event.target.value)}
                      />
                    </Stack>
                    <Stack direction="horizontal" justify="end" gap={2}>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setAddingEvent(false);
                          setEventIdInput("");
                        }}
                      >
                        {t("common.cancel")}
                      </Button>
                      <LoadingButton type="submit" isLoading={isSaving} disabled={!canAddEventId}>
                        {t("admin.instagramPublishing.addEventId")}
                      </LoadingButton>
                    </Stack>
                  </Stack>
                </form>
            ) : currentEventId == null ? (
                <Stack gap={2}>
                  <Label htmlFor="instagram-cover-body">
                    {t("admin.instagramPublishing.coverBody")}
                  </Label>
                  <Textarea
                    id="instagram-cover-body"
                    value={coverBody}
                    maxLength={280}
                    rows={3}
                    disabled={!editable || busy}
                    placeholder={defaultCoverBody(eventIds.length, school?.language ?? "en")}
                    onChange={(event) => setCoverBody(event.target.value)}
                  />
                </Stack>
            ) : editForm ? (
                    <SubmitEventFlow
                      key={currentEventId}
                      canCreateEvents
                      embedded
                      isEditMode
                      showHeading={false}
                      showPreview={false}
                      editEventId={currentEventId}
                      initialData={editForm}
                      onUpdate={handleUpdateEvent}
                      previewBase={savedSlideEvent}
                      onPreviewEventChange={handlePreviewEventChange}
                      saveRef={slideSaveRef}
                      showSubmit={false}
                    />
            ) : null}

            {slideIndex === COVER_INDEX && !addingEvent && <Stack gap={2}>
              <Label htmlFor="instagram-caption-intro">{t("admin.instagramPublishing.captionIntro")}</Label>
              <Textarea
                id="instagram-caption-intro"
                value={captionIntro}
                onChange={(event) => setCaptionIntro(event.target.value)}
                disabled={!editable || busy}
                maxLength={2200}
                rows={3}
              />
              <Stack direction="horizontal" justify="between" align="center" gap={3}>
                <Label htmlFor="instagram-caption">{t("admin.instagramPublishing.caption")}</Label>
                <span className="text-xs text-muted-foreground">
                  {t("admin.instagramPublishing.characterCount", { count: captionLength })}
                </span>
              </Stack>
              <Textarea
                id="instagram-caption"
                value={displayedCaption}
                maxLength={2200}
                rows={10}
                readOnly
              />
            </Stack>}
            </Stack>
          </FormGrid>
        </DrawerBody>

        <DrawerFooter>
          <Stack direction="horizontal" justify="end" gap={2} wrap>
            <Button
              type="button"
              disabled={!editable || busy}
              onClick={() => void startAddingEvent()}
            >
              <Plus className="size-4" />
              {t("admin.instagramPublishing.addEventId")}
            </Button>
            <LoadingButton
              variant="outline"
              isLoading={isSaving || isSavingSlide}
              disabled={!canSave}
              onClick={saveDraft}
            >
              {t("admin.instagramPublishing.saveDraft")}
            </LoadingButton>
            <LoadingButton isLoading={isPublishing} disabled={!canSave} onClick={publish}>
              {t("admin.instagramPublishing.publish")}
            </LoadingButton>
          </Stack>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
