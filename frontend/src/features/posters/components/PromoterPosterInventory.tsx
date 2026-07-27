import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useArchivePromoterPoster } from "@/features/posters/hooks/usePromoterDashboard";
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
import { formatRelativeTimeCompact } from "@/shared/utils/relativeTime";
import { formatCadCents } from "@/shared/utils/currency";
import { toast } from "@/shared/hooks/use-toast";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Download, QrCode } from "@/shared/ui/doodle-icons";
import { LoadingButton } from "@/shared/ui/loading-button";

interface PromoterPosterInventoryProps {
  posters: PromoterPosterEarnings[];
}

const LIFECYCLE_BADGE_VARIANTS: Record<
  PosterLifecycle,
  "secondary" | "success" | "warning" | "muted"
> = {
  "not-placed": "secondary",
  "recently-scanned": "success",
  quiet: "warning",
  archived: "muted",
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
  const archivePoster = useArchivePromoterPoster();
  const [posterToArchive, setPosterToArchive] =
    useState<PromoterPosterEarnings | null>(null);
  const [downloadingPosterId, setDownloadingPosterId] = useState<string | null>(
    null,
  );

  const sortedPosters = posters.toSorted(
    (a, b) => Number(b.isActive) - Number(a.isActive),
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
          (blob) =>
            downloadBlob(blob, `${sanitizeFilename(poster.name)}.png`),
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

  const confirmArchive = () => {
    if (!posterToArchive) {
      return;
    }
    archivePoster.mutate(posterToArchive.id, {
      onSuccess: () => {
        toast({
          variant: "success",
          description: t("posters.inventory.archiveSuccess"),
        });
        setPosterToArchive(null);
      },
    });
  };

  return (
    <>
      <div
        className="grid gap-4 md:grid-cols-2"
        data-testid="poster-inventory"
      >
        {sortedPosters.map((poster) => {
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
                <div className="flex items-start gap-4">
                  <div className="aspect-[8.5/11] w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-secondary">
                    {poster.templatePreviewUrl || template?.assetPath ? (
                      <img
                        src={poster.templatePreviewUrl ?? template?.assetPath}
                        alt={template?.name ?? poster.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <QrCode className="size-8 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <CardTitle className="truncate">{poster.name}</CardTitle>
                    <Badge variant={LIFECYCLE_BADGE_VARIANTS[lifecycle]}>
                      {t(`posters.lifecycle.${lifecycle}`)}
                    </Badge>
                    <CardDescription>
                      {poster.latestScan
                        ? t("posters.inventory.latestScan", {
                            time: formatRelativeTimeCompact(
                              poster.latestScan,
                              t,
                            ),
                          })
                        : t("posters.inventory.neverScanned")}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("posters.inventory.totalVisitors")}
                    </dt>
                    <dd className="font-semibold text-foreground">
                      {poster.lifetimeUniqueVisitors}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("posters.inventory.periodVisitors")}
                    </dt>
                    <dd className="font-semibold text-foreground">
                      {poster.periodCreditableVisitors}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("posters.inventory.periodEarnings")}
                    </dt>
                    <dd className="font-semibold text-foreground">
                      {formatCadCents(poster.pendingCents, i18n.language)}
                    </dd>
                  </div>
                </dl>
                {lifecycle === "not-placed" && (
                  <p className="mt-4 text-xs text-muted-foreground">
                    {t("posters.inventory.activationInstruction")}
                  </p>
                )}
              </CardContent>
              <CardFooter className="flex-wrap gap-2">
                <LoadingButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  isLoading={downloadingPosterId === poster.id}
                  disabled={!template}
                  onClick={() => void downloadPoster(poster, "pdf")}
                  data-testid={`poster-download-pdf-${poster.id}`}
                >
                  <Download />
                  {t("posters.inventory.downloadPdf")}
                </LoadingButton>
                <LoadingButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  isLoading={downloadingPosterId === poster.id}
                  disabled={!template}
                  onClick={() => void downloadPoster(poster, "png")}
                  data-testid={`poster-download-png-${poster.id}`}
                >
                  <Download />
                  {t("posters.inventory.downloadPng")}
                </LoadingButton>
                {poster.isActive && (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setPosterToArchive(poster)}
                    data-testid={`poster-archive-${poster.id}`}
                  >
                    {t("posters.inventory.archive")}
                  </Button>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <Dialog
        open={posterToArchive !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPosterToArchive(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("posters.inventory.archiveTitle")}</DialogTitle>
            <DialogDescription>
              {t("posters.inventory.archiveDescription", {
                name: posterToArchive?.name,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPosterToArchive(null)}
            >
              {t("common.cancel")}
            </Button>
            <LoadingButton
              type="button"
              variant="destructive"
              isLoading={archivePoster.isPending}
              onClick={confirmArchive}
              data-testid="poster-archive-confirm"
            >
              {t("posters.inventory.archive")}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
