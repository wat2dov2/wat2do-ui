import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Plus, X } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
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
import { DrawerBody, Section, Stack } from "@/shared/layout";
import { toast } from "@/shared/hooks/use-toast";
import { getSchoolDisplayName } from "@/shared/constants/schools";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import { queryKeys } from "@/shared/lib/queryKeys";
import { controlBox } from "@/shared/config/controlBox";
import { SubmitEventFlow } from "@/features/events/components/SubmitEventModal";
import { createEventAPI, fetchEventById, updateEventAPI } from "@/features/events/api/events.api";
import { eventToFormData, getEventCategory } from "@/shared/utils/event";
import type { ApiInstagramPublishBatchResponse } from "@/shared/generated";
import type { Event, EventFormData } from "@/shared/types";
import {
  carouselEventIds,
  carouselSlideEvents,
  isBatchEditable,
} from "@/features/admin/lib/instagramCarousel";
import { CarouselSlidePreview } from "@/features/admin/components/instagram/CarouselSlidePreview";

type Batch = ApiInstagramPublishBatchResponse;

interface InstagramCarouselDrawerProps {
  /** Mount with `key={batch.id}` so a different run starts from its own state. */
  batch: Batch;
  isSaving: boolean;
  isPublishing: boolean;
  onClose: () => void;
  onSaveDraft: (draft: {
    caption: string;
    coverBody: string;
    eventIds: number[];
  }) => Promise<Batch>;
  onPublish: (version: number) => Promise<void>;
}

/** The cover is slide 0; event slides follow in carousel order. */
const COVER_INDEX = 0;
const MAX_EVENT_SLIDES = 9;

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
  const [eventIds, setEventIds] = useState<number[]>(() => carouselEventIds(batch));
  const [caption, setCaption] = useState(batch.caption);
  const [coverBody, setCoverBody] = useState(batch.cover_body);
  const [slideIndex, setSlideIndex] = useState(COVER_INDEX);
  const [addingEvent, setAddingEvent] = useState(false);

  const editable = isBatchEditable(batch);
  const slideCount = eventIds.length + 1;
  const currentEventId = slideIndex === COVER_INDEX ? null : (eventIds[slideIndex - 1] ?? null);
  const busy = isSaving || isPublishing;

  // Slides render from the saved carousel, so an event edited here shows up in
  // the preview once the draft is saved and the batch comes back.
  const slideEvents = useMemo(() => carouselSlideEvents(batch), [batch]);
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
      onSaveDraft({ caption: caption.trim(), coverBody, eventIds: slideEventIds }),
    [caption, coverBody, onSaveDraft],
  );

  const handleUpdateEvent = useCallback(
    async (eventId: number, data: EventFormData) => {
      await updateEventAPI(eventId, data);
      // The batch carries its slides' event data, so an edited slide is stale
      // there too until the run is refetched.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.events.detail(eventId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.instagramPublishing.batches() }),
      ]);
      toast({ title: t("admin.instagramPublishing.slideUpdated"), variant: "success" });
    },
    [queryClient, t],
  );

  /**
   * Submitting an event puts it on this carousel for good.
   *
   * The slide is saved with the event rather than waiting for a separate save,
   * so the run survives a refresh and the new slide previews from the batch the
   * server just returned instead of an id with no event behind it.
   */
  const handleCreateEvent = useCallback(
    async (data: EventFormData) => {
      const created = await createEventAPI(data);
      const saved = await persistDraft([...eventIds, created.id]);
      const savedEventIds = carouselEventIds(saved);
      setEventIds(savedEventIds);
      setSlideIndex(savedEventIds.indexOf(created.id) + 1);
      setAddingEvent(false);
      return { type: "event" as const, eventId: created.id };
    },
    [eventIds, persistDraft],
  );

  /** Takes the event off this carousel. The event itself is untouched. */
  const handleRemoveSlide = useCallback(() => {
    if (currentEventId == null) return;
    setEventIds((current) => current.filter((eventId) => eventId !== currentEventId));
    setSlideIndex((current) => Math.max(COVER_INDEX, current - 1));
  }, [currentEventId]);

  const handleSaveDraft = useCallback(async () => {
    const saved = await persistDraft(eventIds);
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
      .then((saved) => onPublish(saved.version))
      .catch((error) => {
        toast({
          title: t("admin.instagramPublishing.publishError"),
          description: getApiErrorMessage(error),
          variant: "destructive",
        });
      });
  }, [handleSaveDraft, onPublish, t]);

  const canSave = editable && !busy && eventIds.length > 0 && caption.trim().length > 0;

  return (
    <Drawer open onOpenChange={(open) => !open && !busy && onClose()}>
      <DrawerContent>
        <DrawerHeader>
          <Stack direction="horizontal" justify="between" align="center" gap={3} wrap>
            <Stack gap={1}>
              <DrawerTitle>{getSchoolDisplayName(batch.school)}</DrawerTitle>
              <DrawerDescription>{batch.local_date}</DrawerDescription>
            </Stack>
            <Button
              type="button"
              disabled={!editable || busy || eventIds.length >= MAX_EVENT_SLIDES}
              onClick={() => setAddingEvent(true)}
            >
              <Plus className="size-4" />
              {t("admin.instagramPublishing.addEvent")}
            </Button>
          </Stack>
        </DrawerHeader>

        <DrawerBody>
          <Stack gap={6}>
            <Stack direction="horizontal" gap={3} align="center" justify="center">
              <Button
                type="button"
                variant="secondary"
                size="icon"
                disabled={slideIndex === COVER_INDEX}
                aria-label={t("admin.instagramPublishing.previousSlide")}
                onClick={() => setSlideIndex((current) => Math.max(COVER_INDEX, current - 1))}
              >
                <ChevronLeft className="size-4" />
              </Button>

              <CarouselSlidePreview
                slideIndex={slideIndex}
                slideCount={slideCount}
                event={previewedSlideEvent}
                cover={{
                  schoolName: getSchoolDisplayName(batch.school),
                  body: coverBody,
                  tiles: coverTiles,
                }}
              />

              <Button
                type="button"
                variant="secondary"
                size="icon"
                disabled={slideIndex >= slideCount - 1}
                aria-label={t("admin.instagramPublishing.nextSlide")}
                onClick={() => setSlideIndex((current) => Math.min(slideCount - 1, current + 1))}
              >
                <ChevronRight className="size-4" />
              </Button>
            </Stack>

            {addingEvent ? (
              <Section variant="surface" title={t("admin.instagramPublishing.addEvent")}>
                <SubmitEventFlow
                  canCreateEvents
                  embedded
                  showHeading={false}
                  showPreview={false}
                  onSubmit={handleCreateEvent}
                  onClose={() => setAddingEvent(false)}
                  onBack={() => setAddingEvent(false)}
                />
              </Section>
            ) : currentEventId == null ? (
              <Section variant="surface" title={t("admin.instagramPublishing.coverSlide")}>
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
                    placeholder={t("admin.instagramPublishing.coverBodyPlaceholder")}
                    onChange={(event) => setCoverBody(event.target.value)}
                  />
                </Stack>
              </Section>
            ) : (
              <Section
                variant="surface"
                title={t("admin.instagramPublishing.slideOf", {
                  index: slideIndex,
                  count: eventIds.length,
                })}
              >
                <Stack gap={4}>
                  {editForm ? (
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
                    />
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!editable || busy || eventIds.length <= 1}
                    className="self-start"
                    onClick={handleRemoveSlide}
                  >
                    <X className="size-4" />
                    {t("admin.instagramPublishing.removeSlide")}
                  </Button>
                </Stack>
              </Section>
            )}

            <Stack gap={2}>
              <Stack direction="horizontal" justify="between" align="center" gap={3}>
                <Label htmlFor="instagram-caption">{t("admin.instagramPublishing.caption")}</Label>
                <span className="text-xs text-muted-foreground">
                  {t("admin.instagramPublishing.characterCount", { count: caption.length })}
                </span>
              </Stack>
              <Textarea
                id="instagram-caption"
                value={caption}
                maxLength={2200}
                rows={10}
                disabled={!editable || busy}
                onChange={(event) => setCaption(event.target.value)}
              />
            </Stack>
          </Stack>
        </DrawerBody>

        <DrawerFooter>
          <Stack direction="horizontal" justify="end" gap={2} wrap>
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
              {t("common.close")}
            </Button>
            <LoadingButton
              variant="secondary"
              isLoading={isSaving}
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
