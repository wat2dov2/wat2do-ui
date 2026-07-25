import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "@/shared/ui/doodle-icons";
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
  includedSlides,
  isBatchEditable,
  slideEvent,
} from "@/features/admin/lib/instagramCarousel";
import type { SlideEvent } from "@/features/admin/lib/instagramSlides";
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

/**
 * Slide data for an event the admin just edited.
 *
 * The stored PNG only catches up on save, but the preview is HTML rendered from
 * event data, so it shows the edit immediately. A recurring event shows its
 * first occurrence - the same one the backend snapshots for the published
 * slide, since both read the server's ascending occurrence order.
 */
function toSlideEvent(event: Event): SlideEvent {
  const occurrence = event.occurrences?.[0];
  return {
    id: event.id,
    title: event.title,
    category: getEventCategory(event),
    location: event.location,
    organization: event.organization,
    ig_handle: event.ig_handle ?? null,
    school: event.school,
    source_image_url: event.source_image_url ?? null,
    dtstart_utc: occurrence?.dtstart_utc ?? null,
    tz: occurrence?.tz ?? null,
    price: event.price,
    food: event.food,
    cancelled: event.cancelled,
  };
}

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
  const [slideEvents, setSlideEvents] = useState<Record<number, SlideEvent>>(() =>
    Object.fromEntries(
      includedSlides(batch).map((item) => [Number(item.event_id), slideEvent(item)]),
    ),
  );
  const [caption, setCaption] = useState(batch.caption);
  const [coverBody, setCoverBody] = useState(batch.cover_body);
  const [slideIndex, setSlideIndex] = useState(COVER_INDEX);
  const [addingEvent, setAddingEvent] = useState(false);

  const editable = isBatchEditable(batch);
  const slideCount = eventIds.length + 1;
  const currentEventId = slideIndex === COVER_INDEX ? null : (eventIds[slideIndex - 1] ?? null);
  const busy = isSaving || isPublishing;

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

  const rememberEvent = useCallback(
    async (eventId: number) => {
      const event = await queryClient.fetchQuery({
        queryKey: queryKeys.events.detail(eventId),
        queryFn: () => fetchEventById(eventId),
        staleTime: 0,
      });
      setSlideEvents((current) => ({ ...current, [eventId]: toSlideEvent(event) }));
    },
    [queryClient],
  );

  const handleUpdateEvent = useCallback(
    async (eventId: number, data: EventFormData) => {
      await updateEventAPI(eventId, data);
      await rememberEvent(eventId);
      toast({ title: t("admin.instagramPublishing.slideUpdated"), variant: "success" });
    },
    [rememberEvent, t],
  );

  const handleCreateEvent = useCallback(
    async (data: EventFormData) => {
      const created = await createEventAPI(data);
      await rememberEvent(created.id);
      setEventIds((current) => [...current, created.id]);
      setSlideIndex(eventIds.length + 1);
      setAddingEvent(false);
      return { type: "event" as const, eventId: created.id };
    },
    [eventIds.length, rememberEvent],
  );

  const handleRemoveSlide = useCallback(() => {
    if (currentEventId == null) return;
    setEventIds((current) => current.filter((eventId) => eventId !== currentEventId));
    setSlideIndex((current) => Math.max(COVER_INDEX, current - 1));
  }, [currentEventId]);

  const handleSaveDraft = useCallback(async () => {
    const saved = await onSaveDraft({ caption: caption.trim(), coverBody, eventIds });
    setEventIds(carouselEventIds(saved));
    return saved;
  }, [caption, coverBody, eventIds, onSaveDraft]);

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
                event={currentEventId == null ? null : (slideEvents[currentEventId] ?? null)}
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
                      onClose={() => undefined}
                    />
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!editable || busy || eventIds.length <= 1}
                    className="self-start text-destructive"
                    onClick={handleRemoveSlide}
                  >
                    <Trash2 className="size-4" />
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
