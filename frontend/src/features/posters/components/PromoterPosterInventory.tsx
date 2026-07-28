import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PosterDownloadMenu } from "@/features/posters/components/PosterDownloadMenu";
import type {
  ApprovedPosterTemplate,
  PosterLifecycle,
  PromoterPosterEarnings,
} from "@/features/posters/types";
import {
  generateAssetPdf,
  generateAssetPngs,
  sanitizeFilename,
} from "@/features/posters/utils/generateAssetPdf";
import { getPosterLifecycle } from "@/features/posters/utils/posterLifecycle";
import { promoterProgram } from "@/shared/config/promoterProgram";
import { FormGrid, Stack } from "@/shared/layout";
import { formatRelativeTimeCompact } from "@/shared/utils/relativeTime";
import { formatCadCents } from "@/shared/utils/currency";
import { toast } from "@/shared/hooks/use-toast";
import { Badge } from "@/shared/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { QrCode } from "@/shared/ui/doodle-icons";

interface PromoterPosterInventoryProps {
  posters: PromoterPosterEarnings[];
}

const LIFECYCLE_BADGE_VARIANTS: Record<
  PosterLifecycle,
  "secondary" | "success" | "warning"
> = {
  "not-placed": "secondary",
  "recently-scanned": "success",
  quiet: "warning",
};

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function getTemplate(
  poster: PromoterPosterEarnings,
): ApprovedPosterTemplate | undefined {
  return promoterProgram.approvedTemplates.find(
    (template) => template.id === poster.posterTemplateId,
  );
}

export function PromoterPosterInventory({
  posters,
}: PromoterPosterInventoryProps) {
  const { t, i18n } = useTranslation();
  const [downloadingPosterId, setDownloadingPosterId] = useState<string | null>(
    null,
  );

  const downloadPoster = async (
    poster: PromoterPosterEarnings,
    format: "pdf" | "png",
  ) => {
    const template = getTemplate(poster);
    if (!template) {
      toast({
        variant: "destructive",
        description: t("posters.inventory.templateUnavailable"),
      });
      return;
    }

    setDownloadingPosterId(poster.id);
    try {
      const asset = {
        imagePreview: template.assetPath,
        name: poster.name,
        quantity: 1,
        placement: template.qrPlacement,
      };
      const options = {
        printSize: template.printSize,
        orientation: template.orientation,
        pageLabels: [poster.name],
      };
      if (format === "pdf") {
        const blob = await generateAssetPdf(
          asset,
          [poster.id],
          window.location.origin,
          options,
        );
        downloadBlob(blob, `${sanitizeFilename(poster.name)}.pdf`);
      } else {
        await generateAssetPngs(
          asset,
          [poster.id],
          window.location.origin,
          options,
          (blob) => downloadBlob(blob, `${sanitizeFilename(poster.name)}.png`),
        );
      }
    } catch (error) {
      console.error("Poster download failed:", error);
      toast({
        variant: "destructive",
        description: t("posters.inventory.downloadError"),
      });
    } finally {
      setDownloadingPosterId(null);
    }
  };

  return (
    <FormGrid columns={2} data-testid="poster-inventory">
      {posters.map((poster) => {
        const lifecycle = getPosterLifecycle(
          poster,
          promoterProgram.quietPosterDays,
        );
        const template = getTemplate(poster);
        return (
          <Card
            key={poster.id}
            id={`poster-${poster.id}`}
            data-testid={`poster-card-${poster.id}`}
            className="scroll-mt-24"
          >
            <CardHeader>
              <Stack direction="horizontal" align="start" gap={4}>
                <div className="aspect-[8.5/11] w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-secondary">
                  {poster.templatePreviewUrl || template?.assetPath ? (
                    <img
                      src={poster.templatePreviewUrl ?? template?.assetPath}
                      alt={template?.name ?? poster.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Stack align="center" justify="center" className="h-full">
                      <QrCode className="size-8 text-muted-foreground" />
                    </Stack>
                  )}
                </div>
                <Stack gap={2} align="start" grow className="min-w-0">
                  <CardTitle className="max-w-full truncate">
                    {poster.name}
                  </CardTitle>
                  <Badge variant={LIFECYCLE_BADGE_VARIANTS[lifecycle]}>
                    {poster.latestScan
                      ? t("posters.inventory.lastScanned", {
                          time: formatRelativeTimeCompact(poster.latestScan, t),
                        })
                      : t(`posters.lifecycle.${lifecycle}`)}
                  </Badge>
                </Stack>
              </Stack>
            </CardHeader>
            <CardContent>
              <Stack gap={4}>
                <FormGrid
                  as="dl"
                  columns={3}
                  collapse={false}
                  className="text-sm"
                >
                  <Stack gap={1}>
                    <dt className="text-xs text-muted-foreground">
                      {t("posters.inventory.totalVisitors")}
                    </dt>
                    <dd className="font-semibold text-foreground">
                      {poster.lifetimeUniqueVisitors}
                    </dd>
                  </Stack>
                  <Stack gap={1}>
                    <dt className="text-xs text-muted-foreground">
                      {t("posters.inventory.periodVisitors")}
                    </dt>
                    <dd className="font-semibold text-foreground">
                      {poster.periodCreditableVisitors}
                    </dd>
                  </Stack>
                  <Stack gap={1}>
                    <dt className="text-xs text-muted-foreground">
                      {t("posters.inventory.periodEarnings")}
                    </dt>
                    <dd className="font-semibold text-foreground">
                      {formatCadCents(poster.pendingCents, i18n.language)}
                    </dd>
                  </Stack>
                </FormGrid>
                {lifecycle === "not-placed" && (
                  <p className="text-xs text-muted-foreground">
                    {t("posters.inventory.activationInstruction")}
                  </p>
                )}
              </Stack>
            </CardContent>
            <CardFooter>
              <Stack direction="horizontal" wrap gap={2}>
                <PosterDownloadMenu
                  variant="secondary"
                  size="sm"
                  isLoading={downloadingPosterId === poster.id}
                  disabled={!template}
                  onDownload={(format) => void downloadPoster(poster, format)}
                  testId={`poster-download-${poster.id}`}
                />
              </Stack>
            </CardFooter>
          </Card>
        );
      })}
    </FormGrid>
  );
}
