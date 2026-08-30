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
import { Pagination } from "@/shared/ui/Pagination";
import { toast } from "@/shared/hooks/use-toast";

interface AdminInstagramPageProps {
  onBack: () => void;
}

const BATCHES_PER_PAGE = 25;

export function AdminInstagramPage({ onBack }: AdminInstagramPageProps) {
  const { t } = useTranslation();
  const [pageNumber, setPageNumber] = useState(1);
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);
  const {
    page,
    isLoading,
    error,
    retry,
    batch: openBatch,
    isDetailLoading,
    detailError,
    retryDetail,
    updateBatch,
    publishBatch,
    updatingBatchId,
    publishingBatchId,
  } = useInstagramPublishing(pageNumber, BATCHES_PER_PAGE, openBatchId);
  const batches = page?.items ?? [];

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
              <Button variant="outline" onClick={() => retry()}>
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
          <Stack gap={4}>
            <InstagramRunsTable batches={batches} onOpenRun={setOpenBatchId} />
            <Pagination
              currentPage={page?.page ?? 1}
              totalPages={page?.total_pages ?? 1}
              onPageChange={(nextPage) => {
                setOpenBatchId(null);
                setPageNumber(nextPage);
              }}
            />
          </Stack>
        )}

        {openBatchId && isDetailLoading ? (
          <LoadingPage className="min-h-[240px]" />
        ) : openBatchId && detailError ? (
          <Section variant="surface" className="text-center">
            <Stack gap={4} align="center">
              <p className="text-sm text-destructive">
                {getApiErrorMessage(detailError, t("admin.instagramPublishing.loadError"))}
              </p>
              <Button variant="outline" onClick={() => retryDetail()}>
                {t("admin.instagramPublishing.retry")}
              </Button>
            </Stack>
          </Section>
        ) : null}
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
