import { useTranslation } from "react-i18next";
import type { ApiInstagramPublishBatchResponse } from "@/shared/generated";
import { Stack } from "@/shared/layout";
import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Link } from "@/shared/ui/link";

type Batch = Pick<
  ApiInstagramPublishBatchResponse,
  "status" | "permalink" | "music_status" | "music_track" | "music_error"
>;

/** Where the published post's song stands: the Mac's emulator adds one after it publishes. */
export function InstagramMusicStatus({ batch }: { batch: Batch }) {
  const { t } = useTranslation();
  const state = batch.status !== "published"
    ? t("admin.instagramPublishing.music.afterPublish")
    : batch.music_status === "added"
      ? t("admin.instagramPublishing.music.added", { track: batch.music_track })
      : batch.music_status === "failed"
        ? t("admin.instagramPublishing.music.failed", { reason: batch.music_error })
        : batch.music_status === "pending"
          ? t("admin.instagramPublishing.music.pending")
          : t("admin.instagramPublishing.music.none");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.instagramPublishing.music.title")}</CardTitle>
        <CardDescription>
          <Stack gap={2}>
            <span>{state}</span>
            {batch.permalink ? (
              <Link href={batch.permalink} target="_blank" rel="noopener noreferrer">
                {t("admin.instagramPublishing.music.viewPost")}
              </Link>
            ) : null}
          </Stack>
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
