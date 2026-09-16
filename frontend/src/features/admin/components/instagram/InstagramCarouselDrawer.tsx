import { useCallback, useMemo, useState, type MutableRefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { getSchoolColors } from "@/shared/lib/schoolBranding";
import { InstagramEventEditor } from "./InstagramEventEditor";
import { fetchEventById, updateEventAPI } from "@/features/events/api/events.api";
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
  const previewEventIds: (number | null)[] = publishedAssets.length
    ? publishedAssets.map(() => null) : [null, ...eventIds];
  const slideCount = previewEventIds.length;
  const coverTiles = useMemo(
    () =>
      eventIds
        .map((eventId) => slideEvents[eventId]?.source_image_url ?? "")
        .filter((url) => url.length > 0),
    [eventIds, slideEvents],
  );

  const [editors, setEditors] = useState<Array<{
    eventId: number;
    saveRef: MutableRefObject<(() => Promise<boolean>) | null>;
  }>>([]);
  const [liveSlides, setLiveSlides] = useState<Record<number, Event>>({});
  const openEditor = useCallback((eventId: number | null) => {
    if (eventId == null) return;
    setEditors((current) => current.some((editor) => editor.eventId === eventId)
      ? current : [...current, { eventId, saveRef: { current: null } }]);
  }, []);
  const handlePreviewEventChange = useCallback((eventId: number, event: Event) => {
    setLiveSlides((current) => ({ ...current, [eventId]: event }));
  }, []);

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

  /** Validate the event exists; keep the carousel change local until Save. */
  const handleAddEventId = useCallback(async () => {
    if (!canAddEventId || busy) return;
    setIsSavingSlide(true);
    try {
      await fetchEventById(parsedEventId);
      setEventIds([...eventIds, parsedEventId]);
      openEditor(parsedEventId);
      setSlideIndex(eventIds.length + 1);
      setAddingEvent(false);
      setEventIdInput("");
    } finally {
      setIsSavingSlide(false);
    }
  }, [canAddEventId, busy, eventIds, parsedEventId, openEditor]);

  const addEventId = useCallback(() => {
    handleAddEventId().catch((error) => {
      toast({
        title: t("admin.instagramPublishing.addEventError"),
        description: getApiErrorMessage(error),
        variant: "destructive",
      });
    });
  }, [handleAddEventId, t]);

  /** Removing a slide only changes this unsaved carousel. */
  const handleRemoveSlide = useCallback((removedEventId: number) => {
    if (!editable || busy || eventIds.length <= 1) return;
    const next = eventIds.filter((eventId) => eventId !== removedEventId);
    setEventIds(next);
    setSlideIndex(currentEventId == null || currentEventId === removedEventId
      ? COVER_INDEX : next.indexOf(currentEventId) + 1);
    setEditors((current) => current.filter((editor) => editor.eventId !== removedEventId));
  }, [currentEventId, eventIds, editable, busy]);

  /** Save visited forms before saving the carousel, including offscreen edits. */
  const handleSaveDraft = useCallback(async () => {
    setIsSavingSlide(true);
    try {
      for (const editor of editors) {
        if (editor.saveRef.current && !(await editor.saveRef.current())) {
          setAddingEvent(false);
          setSlideIndex(eventIds.indexOf(editor.eventId) + 1);
          return null;
        }
      }
      const saved = await persistDraft(eventIds);
      setEventIds(carouselEventIds(saved));
      return saved;
    } finally {
      setIsSavingSlide(false);
    }
  }, [editors, eventIds, persistDraft]);

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

  const startAddingEvent = () => {
    if (!busy) setAddingEvent(true);
  };

  const selectSlide = (index: number) => {
    if (busy) return;
    setAddingEvent(false);
    if (editable) openEditor(index === COVER_INDEX ? null : eventIds[index - 1] ?? null);
    setSlideIndex(index);
  };

  const reorderSlide = (sourceId: number, position: number) => {
    if (!editable || busy || !Number.isSafeInteger(position) || position < 1 || position > eventIds.length || !eventIds.includes(sourceId)) return;
    const next = eventIds.filter((id) => id !== sourceId);
    next.splice(position - 1, 0, sourceId);
    setEventIds(next);
    setSlideIndex(currentEventId == null ? COVER_INDEX : next.indexOf(currentEventId) + 1);
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
              {previewEventIds.map((eventId, index) => (
              <CarouselSlidePreview
                key={publishedAssets.length ? `published-${index}` : eventId ?? "cover"}
                selected={slideIndex === index}
                onSelect={() => void selectSlide(index)}
                disabled={busy}
                removeDisabled={eventIds.length <= 1}
                onRemove={editable && eventId != null ? () => void handleRemoveSlide(eventId) : undefined}
                onPositionChange={editable && eventId != null ? (position) => void reorderSlide(eventId, position) : undefined}
                slideIndex={index}
                slideCount={slideCount}
                event={eventId == null ? null : liveSlides[eventId] ?? slideEvents[eventId] ?? null}
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
            ) : null}

            {editable && editors.map(({ eventId, saveRef }) => (
              <InstagramEventEditor
                key={eventId}
                eventId={eventId}
                active={!addingEvent && currentEventId === eventId}
                saveRef={saveRef}
                onUpdate={handleUpdateEvent}
                onPreviewEventChange={handlePreviewEventChange}
              />
            ))}

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
