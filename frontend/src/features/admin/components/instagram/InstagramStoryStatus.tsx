import { useTranslation } from "react-i18next";
import type { ApiInstagramPublishBatchResponse } from "@/shared/generated";
import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";

type Batch = Pick<ApiInstagramPublishBatchResponse, "status" | "story_status" | "story_error">;

/** Where the published carousel's story stands: each slide goes to the account's story right after it publishes. */
export function InstagramStoryStatus({ batch }: { batch: Batch }) {
  const { t } = useTranslation();
  const state = batch.status !== "published"
    ? t("admin.instagramPublishing.story.afterPublish")
    : batch.story_status === "posted"
      ? t("admin.instagramPublishing.story.posted")
      : batch.story_status === "failed"
        ? t("admin.instagramPublishing.story.failed", { reason: batch.story_error })
        : batch.story_status === "pending"
          ? t("admin.instagramPublishing.story.pending")
          : t("admin.instagramPublishing.story.none");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.instagramPublishing.story.title")}</CardTitle>
        <CardDescription>{state}</CardDescription>
      </CardHeader>
    </Card>
  );
}
