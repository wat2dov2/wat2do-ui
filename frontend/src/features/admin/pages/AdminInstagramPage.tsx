import { useState } from "react";
import { useTranslation } from "react-i18next";
import { InstagramCarouselDrawer } from "@/features/admin/components/instagram/InstagramCarouselDrawer";
import { InstagramRunsTable } from "@/features/admin/components/instagram/InstagramRunsTable";
import { AdminPageHeader } from "@/features/admin/components/shared/AdminPageHeader";
import { useInstagramPublishing } from "@/features/admin/hooks/useInstagramPublishing";
import { Container, Section, Stack } from "@/shared/layout";
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
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);

  const openBatch = batches.find((batch) => batch.id === openBatchId) ?? null;

  return (
    <Container size="lg">
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
          <Section variant="surface" className="text-center">
            <Stack gap={4} align="center">
              <p className="text-sm text-destructive">
                {getApiErrorMessage(error, t("admin.instagramPublishing.loadError"))}
              </p>
              <Button variant="secondary" onClick={() => retry()}>
                {t("admin.instagramPublishing.retry")}
              </Button>
            </Stack>
          </Section>
        ) : batches.length === 0 ? (
          <Section variant="surface" className="text-center">
            <p className="text-sm text-muted-foreground">
              {t("admin.instagramPublishing.noBatches")}
            </p>
          </Section>
        ) : (
          <InstagramRunsTable batches={batches} onOpenRun={(batch) => setOpenBatchId(batch.id)} />
        )}
      </Stack>

      {openBatch ? (
        <InstagramCarouselDrawer
          key={openBatch.id}
          batch={openBatch}
          isSaving={updatingBatchId === openBatch.id}
          isPublishing={publishingBatchId === openBatch.id}
          onClose={() => setOpenBatchId(null)}
          onSaveDraft={async ({ caption, coverBody, eventIds }) => {
            const saved = await updateBatch({
              id: openBatch.id,
              data: {
                version: openBatch.version,
                caption,
                cover_body: coverBody,
                event_ids: eventIds,
              },
            });
            toast({ title: t("admin.instagramPublishing.saved"), variant: "success" });
            return saved;
          }}
          onPublish={async (version) => {
            await publishBatch({ id: openBatch.id, data: { version } });
            toast({ title: t("admin.instagramPublishing.published"), variant: "success" });
          }}
        />
      ) : null}
    </Container>
  );
}
