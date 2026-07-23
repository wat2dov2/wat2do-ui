import { useTranslation } from "react-i18next";
import { InstagramBatchReview } from "@/features/admin/components/instagram/InstagramBatchReview";
import { AdminPageHeader } from "@/features/admin/components/shared/AdminPageHeader";
import { useInstagramPublishing } from "@/features/admin/hooks/useInstagramPublishing";
import { Container, Stack } from "@/shared/layout";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import { Button } from "@/shared/ui/button";
import { Instagram } from "@/shared/ui/doodle-icons";
import { LoadingPage } from "@/shared/ui/loading-page";
import { toast } from "@/shared/hooks/use-toast";

interface AdminInstagramPageProps {
  onBack: () => void;
}

export function AdminInstagramPage({ onBack }: AdminInstagramPageProps) {
  const { t } = useTranslation();
  const {
    batches,
    isLoading,
    error,
    retry,
    updateBatch,
    publishBatch,
    updatingBatchId,
    publishingBatchId,
  } = useInstagramPublishing();

  return (
    <Container size="lg" className="px-0">
      <Stack gap={6}>
        <AdminPageHeader
          icon={Instagram}
          title={t("admin.instagramPublishing.title")}
          description={t("admin.instagramPublishing.description")}
          onBack={onBack}
        />

        {isLoading ? (
          <LoadingPage className="min-h-[360px]" />
        ) : error ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-center">
            <p className="mb-4 text-sm text-destructive">
              {getApiErrorMessage(error, t("admin.instagramPublishing.loadError"))}
            </p>
            <Button variant="secondary" onClick={() => retry()}>
              {t("admin.instagramPublishing.retry")}
            </Button>
          </div>
        ) : batches.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-10 text-center">
            <p className="text-sm text-muted-foreground">
              {t("admin.instagramPublishing.noBatches")}
            </p>
          </div>
        ) : (
          <Stack gap={6}>
            {batches.map((batch) => (
              <InstagramBatchReview
                key={batch.id}
                batch={batch}
                isSaving={updatingBatchId === batch.id}
                isPublishing={publishingBatchId === batch.id}
                onSave={async (caption, itemIds) => {
                  try {
                    const updated = await updateBatch({
                      id: batch.id,
                      data: {
                        version: batch.version,
                        caption,
                        item_ids: itemIds,
                      },
                    });
                    toast({
                      title: t("admin.instagramPublishing.saved"),
                      variant: "success",
                    });
                    return updated;
                  } catch (saveError) {
                    toast({
                      title: t("admin.instagramPublishing.saveError"),
                      description: getApiErrorMessage(saveError),
                      variant: "destructive",
                    });
                    throw saveError;
                  }
                }}
                onPublish={async (version) => {
                  try {
                    await publishBatch({
                      id: batch.id,
                      data: { version },
                    });
                    toast({
                      title: t("admin.instagramPublishing.published"),
                      variant: "success",
                    });
                  } catch (publishError) {
                    toast({
                      title: t("admin.instagramPublishing.publishError"),
                      description: getApiErrorMessage(publishError),
                      variant: "destructive",
                    });
                    throw publishError;
                  }
                }}
              />
            ))}
          </Stack>
        )}
      </Stack>
    </Container>
  );
}
