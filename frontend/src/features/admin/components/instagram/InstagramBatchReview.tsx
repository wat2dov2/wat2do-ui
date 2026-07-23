import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApiInstagramPublishBatchResponse } from "@/shared/generated";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Instagram,
  Trash2,
} from "@/shared/ui/doodle-icons";
import { LoadingButton } from "@/shared/ui/loading-button";
import { Textarea } from "@/shared/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

type Batch = ApiInstagramPublishBatchResponse;
type BatchItem = Batch["items"][number];

interface InstagramBatchReviewProps {
  batch: Batch;
  isSaving: boolean;
  isPublishing: boolean;
  onSave: (caption: string, itemIds: string[]) => Promise<Batch>;
  onPublish: (version: number) => Promise<void>;
}

const editableStatuses = new Set(["ready_for_review", "failed"]);

export function InstagramBatchReview({
  batch,
  isSaving,
  isPublishing,
  onSave,
  onPublish,
}: InstagramBatchReviewProps) {
  const { t } = useTranslation();
  const [caption, setCaption] = useState(batch.caption);
  const [itemIds, setItemIds] = useState(() => includedItemIds(batch));
  const [confirmingPublish, setConfirmingPublish] = useState(false);

  useEffect(() => {
    setCaption(batch.caption);
    setItemIds(includedItemIds(batch));
  }, [batch]);

  const itemsById = useMemo(
    () => new Map(batch.items.map((item) => [item.id, item])),
    [batch.items],
  );
  const selectedItems = itemIds.flatMap((id) => {
    const item = itemsById.get(id);
    return item ? [item] : [];
  });
  const removedItems = batch.items.filter((item) => !itemIds.includes(item.id));
  const originalIds = includedItemIds(batch);
  const isDirty =
    caption !== batch.caption ||
    itemIds.length !== originalIds.length ||
    itemIds.some((id, index) => id !== originalIds[index]);
  const isEditable = editableStatuses.has(batch.status) && batch.items.length > 0;
  const canPublish = isEditable && itemIds.length > 0;

  const save = () => onSave(caption.trim(), itemIds);
  const publish = async () => {
    let version = batch.version;
    if (isDirty) {
      const updated = await save();
      version = updated.version;
    }
    await onPublish(version);
    setConfirmingPublish(false);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <CardTitle className="flex items-center gap-2">
                <Instagram className="size-5 text-primary" />
                {batch.account_key}
              </CardTitle>
              <CardDescription>
                {t("admin.instagramPublishing.batchDescription", {
                  date: batch.local_date,
                  count: selectedItems.length,
                })}
              </CardDescription>
            </div>
            <BatchStatusBadge status={batch.status} />
          </div>
          {batch.error_message && (
            <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {batch.error_message}
            </p>
          )}
        </CardHeader>

        <CardContent className="space-y-6">
          {batch.cover_image_url && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">
                {t("admin.instagramPublishing.cover")}
              </h3>
              <div className="max-w-72">
                <SlidePreview
                  imageUrl={batch.cover_image_url}
                  label={t("admin.instagramPublishing.cover")}
                  eager
                />
              </div>
            </div>
          )}

          {selectedItems.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">
                {t("admin.instagramPublishing.eventSlides")}
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {selectedItems.map((item, index) => (
                  <EventSlide
                    key={item.id}
                    item={item}
                    index={index}
                    count={selectedItems.length}
                    disabled={!isEditable || isSaving || isPublishing}
                    onMove={(direction) =>
                      setItemIds((current) => moveItem(current, index, direction))
                    }
                    onRemove={() =>
                      setItemIds((current) => current.filter((id) => id !== item.id))
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {isEditable && removedItems.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">
                {t("admin.instagramPublishing.removedSlides")}
              </h3>
              <div className="flex flex-wrap gap-2">
                {removedItems.map((item) => (
                  <Button
                    key={item.id}
                    variant="secondary"
                    size="sm"
                    disabled={itemIds.length >= 9}
                    onClick={() => setItemIds((current) => [...current, item.id])}
                  >
                    {t("admin.instagramPublishing.restore", {
                      title: eventTitle(item),
                    })}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {batch.items.length === 0 && (
            <div className="rounded-xl border border-border bg-secondary p-6 text-center text-sm text-muted-foreground">
              {t("admin.instagramPublishing.noEligibleEvents")}
            </div>
          )}

          {batch.items.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor={`instagram-caption-${batch.id}`}
                  className="text-sm font-semibold text-foreground"
                >
                  {t("admin.instagramPublishing.caption")}
                </label>
                <span className="text-xs text-muted-foreground">
                  {t("admin.instagramPublishing.characterCount", {
                    count: caption.length,
                  })}
                </span>
              </div>
              <Textarea
                id={`instagram-caption-${batch.id}`}
                value={caption}
                maxLength={2200}
                rows={14}
                disabled={!isEditable || isSaving || isPublishing}
                onChange={(event) => setCaption(event.target.value)}
              />
            </div>
          )}

          {isEditable && (
            <div className="flex flex-wrap justify-end gap-2">
              <LoadingButton
                variant="secondary"
                isLoading={isSaving}
                disabled={!isDirty || itemIds.length === 0 || !caption.trim() || isPublishing}
                onClick={save}
              >
                {t("admin.instagramPublishing.saveDraft")}
              </LoadingButton>
              <LoadingButton
                isLoading={isPublishing}
                disabled={!canPublish || !caption.trim() || isSaving}
                onClick={() => setConfirmingPublish(true)}
              >
                {t("admin.instagramPublishing.publish")}
              </LoadingButton>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={confirmingPublish}
        onOpenChange={(open) => !isPublishing && setConfirmingPublish(open)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("admin.instagramPublishing.confirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("admin.instagramPublishing.confirmDescription", {
                account: batch.account_key,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={isPublishing}
              onClick={() => setConfirmingPublish(false)}
            >
              {t("common.cancel")}
            </Button>
            <LoadingButton isLoading={isPublishing} onClick={publish}>
              {t("admin.instagramPublishing.confirmPublish")}
            </LoadingButton>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EventSlide({
  item,
  index,
  count,
  disabled,
  onMove,
  onRemove,
}: {
  item: BatchItem;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-secondary">
      <SlidePreview imageUrl={item.asset_url} label={eventTitle(item)} />
      <div className="space-y-3 p-3">
        <div>
          <p className="line-clamp-1 text-sm font-semibold text-foreground">
            {eventTitle(item)}
          </p>
          <p className="line-clamp-2 text-xs text-muted-foreground">{item.ai_reason}</p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" size="sm">
            {t("admin.instagramPublishing.score", {
              score: Number(item.overall_score).toFixed(1),
            })}
          </Badge>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={disabled || index === 0}
              aria-label={t("admin.instagramPublishing.moveEarlier")}
              onClick={() => onMove(-1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={disabled || index === count - 1}
              aria-label={t("admin.instagramPublishing.moveLater")}
              onClick={() => onMove(1)}
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={disabled || count === 1}
              aria-label={t("admin.instagramPublishing.removeSlide")}
              onClick={onRemove}
            >
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SlidePreview({
  imageUrl,
  label,
  eager = false,
}: {
  imageUrl: string;
  label: string;
  eager?: boolean;
}) {
  return (
    <Image
      src={imageUrl}
      alt={label}
      width={1080}
      height={1350}
      loading={eager ? "eager" : "lazy"}
      unoptimized
      className="aspect-[4/5] w-full bg-muted object-cover"
    />
  );
}

function BatchStatusBadge({ status }: { status: Batch["status"] }) {
  const { t } = useTranslation();
  const variant =
    status === "published"
      ? "default"
      : status === "failed"
        ? "destructive"
        : status === "ready_for_review"
          ? "new"
          : "outline";
  return (
    <Badge variant={variant}>
      {t(`admin.instagramPublishing.status.${status}`)}
    </Badge>
  );
}

function includedItemIds(batch: Batch): string[] {
  return batch.items
    .filter((item) => item.included)
    .sort((left, right) => Number(left.position) - Number(right.position))
    .map((item) => item.id);
}

function eventTitle(item: BatchItem): string {
  const title = item.event_snapshot.title;
  return typeof title === "string" ? title : String(title ?? "");
}

function moveItem(items: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) {
    return items;
  }
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
