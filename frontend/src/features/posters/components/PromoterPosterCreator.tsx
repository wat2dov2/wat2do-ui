import { useMemo, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useTranslation } from "react-i18next";

import { useCreatePromoterPosters } from "@/features/posters/hooks/usePromoterDashboard";
import type {
  ApprovedPosterTemplate,
  QRCode,
} from "@/features/posters/types";
import {
  generateAssetPdf,
  generateAssetPngs,
  sanitizeFilename,
} from "@/features/posters/utils/generateAssetPdf";
import { promoterProgram } from "@/shared/config/promoterProgram";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import { generateQRCodeUrl } from "@/shared/utils/qrGenerator";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
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
import { Download, ExternalLink, Plus, QrCode } from "@/shared/ui/doodle-icons";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { LoadingButton } from "@/shared/ui/loading-button";
import { toast } from "@/shared/hooks/use-toast";

interface PromoterPosterCreatorProps {
  school: string;
  activeSlotsUsed: number;
  activeSlotsLimit: number;
  disabled?: boolean;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function PosterPreview({
  poster,
  template,
}: {
  poster: QRCode;
  template: ApprovedPosterTemplate;
}) {
  const placement = template.qrPlacement;
  return (
    <div className="space-y-2">
      <div className="relative aspect-[8.5/11] overflow-hidden rounded-lg border border-border bg-secondary">
        <img
          src={template.assetPath}
          alt={template.name}
          className="h-full w-full object-contain"
        />
        <div
          className="absolute flex items-center justify-center bg-background"
          style={{
            left: `${placement.x * 100}%`,
            top: `${placement.y * 100}%`,
            width: `${placement.width * 100}%`,
            height: `${placement.height * 100}%`,
          }}
        >
          <QRCodeSVG
            value={generateQRCodeUrl(poster.id)}
            className="h-full w-full"
            marginSize={4}
          />
        </div>
      </div>
      <p className="truncate text-xs font-medium text-foreground">{poster.name}</p>
    </div>
  );
}

export function PromoterPosterCreator({
  school,
  activeSlotsUsed,
  activeSlotsLimit,
  disabled = false,
}: PromoterPosterCreatorProps) {
  const { t } = useTranslation();
  const createPosters = useCreatePromoterPosters();
  const eligibleTemplates = useMemo(
    () =>
      promoterProgram.approvedTemplates.filter(
        (template) =>
          template.availableForCreation &&
          (template.eligibleSchool === "global" ||
            template.eligibleSchool === school),
      ),
    [school],
  );
  const [open, setOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    eligibleTemplates[0]?.id ?? "",
  );
  const [placementName, setPlacementName] = useState("");
  const [copies, setCopies] = useState(1);
  const [createdPosters, setCreatedPosters] = useState<QRCode[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const remainingSlots = Math.max(0, activeSlotsLimit - activeSlotsUsed);
  const selectedTemplate =
    eligibleTemplates.find((template) => template.id === selectedTemplateId) ??
    eligibleTemplates[0];

  const reset = () => {
    createPosters.reset();
    setCreatedPosters([]);
    setPlacementName("");
    setCopies(1);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      reset();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTemplate) {
      return;
    }
    try {
      const result = await createPosters.mutateAsync({
        posterTemplateId: selectedTemplate.id,
        name: placementName,
        copies,
      });
      setCreatedPosters(result.posters);
    } catch {
      // The mutation owns and renders the sanitized API error below.
    }
  };

  const labels = createdPosters.map((poster) => poster.name);

  const downloadPdf = async () => {
    if (!selectedTemplate || createdPosters.length === 0) {
      return;
    }
    setIsDownloading(true);
    try {
      const blob = await generateAssetPdf(
        {
          imagePreview: selectedTemplate.assetPath,
          name: placementName,
          quantity: createdPosters.length,
          placement: selectedTemplate.qrPlacement,
        },
        createdPosters.map((poster) => poster.id),
        window.location.origin,
        {
          printSize: selectedTemplate.printSize,
          orientation: selectedTemplate.orientation,
          pageLabels: labels,
        },
      );
      downloadBlob(blob, `${sanitizeFilename(placementName)}.pdf`);
    } catch (error) {
      console.error("Poster PDF download failed:", error);
      toast({
        variant: "destructive",
        description: t("posters.create.downloadError"),
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const downloadPngs = async () => {
    if (!selectedTemplate || createdPosters.length === 0) {
      return;
    }
    setIsDownloading(true);
    try {
      await generateAssetPngs(
        {
          imagePreview: selectedTemplate.assetPath,
          name: placementName,
          quantity: createdPosters.length,
          placement: selectedTemplate.qrPlacement,
        },
        createdPosters.map((poster) => poster.id),
        window.location.origin,
        {
          printSize: selectedTemplate.printSize,
          orientation: selectedTemplate.orientation,
          pageLabels: labels,
        },
        (blob, index) => {
          downloadBlob(
            blob,
            `${sanitizeFilename(placementName)}-copy-${index + 1}.png`,
          );
        },
      );
    } catch (error) {
      console.error("Poster PNG download failed:", error);
      toast({
        variant: "destructive",
        description: t("posters.create.downloadError"),
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled || remainingSlots === 0}
        data-testid="poster-create-open"
      >
        <Plus />
        {t("posters.create.open")}
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[90dvh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("posters.create.title")}</DialogTitle>
            <DialogDescription>
              {t("posters.create.description")}
            </DialogDescription>
          </DialogHeader>

          {createdPosters.length > 0 && selectedTemplate ? (
            <div className="space-y-6" data-testid="poster-created-previews">
              <Alert variant="success">
                <QrCode />
                <AlertTitle>{t("posters.create.createdTitle")}</AlertTitle>
                <AlertDescription>
                  {t("posters.create.createdDescription", {
                    count: createdPosters.length,
                  })}
                </AlertDescription>
              </Alert>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {createdPosters.map((poster) => (
                  <PosterPreview
                    key={poster.id}
                    poster={poster}
                    template={selectedTemplate}
                  />
                ))}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <LoadingButton
                  type="button"
                  variant="secondary"
                  isLoading={isDownloading}
                  onClick={() => void downloadPngs()}
                  data-testid="poster-batch-download-png"
                >
                  <Download />
                  {t("posters.create.downloadPng")}
                </LoadingButton>
                <LoadingButton
                  type="button"
                  isLoading={isDownloading}
                  onClick={() => void downloadPdf()}
                  data-testid="poster-batch-download-pdf"
                >
                  <Download />
                  {t("posters.create.downloadPdf")}
                </LoadingButton>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-3">
                <div>
                  <h3 className="font-semibold text-foreground">
                    {t("posters.create.chooseTemplate")}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t("posters.create.chooseTemplateDescription")}
                  </p>
                </div>
                <div
                  className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                  data-testid="poster-template-gallery"
                >
                  {eligibleTemplates.map((template) => (
                    <Card
                      key={template.id}
                      className="overflow-hidden py-0"
                      data-testid={`poster-template-${template.id}`}
                    >
                      <img
                        src={template.assetPath}
                        alt={template.name}
                        className="aspect-[8.5/11] w-full bg-secondary object-cover"
                      />
                      <CardHeader>
                        <CardTitle>{template.name}</CardTitle>
                        <CardDescription>
                          {template.previewDescription}
                        </CardDescription>
                      </CardHeader>
                      <CardFooter className="pb-5">
                        <Button
                          type="button"
                          variant="secondary"
                          selected={selectedTemplate?.id === template.id}
                          onClick={() => setSelectedTemplateId(template.id)}
                          className="w-full"
                        >
                          {t("posters.create.selectTemplate")}
                        </Button>
                      </CardFooter>
                    </Card>
                  ))}
                  <Card>
                    <CardHeader>
                      <CardTitle>{t("posters.create.customTitle")}</CardTitle>
                      <CardDescription>
                        {t("posters.create.customDescription")}
                      </CardDescription>
                    </CardHeader>
                    <CardFooter>
                      <Button asChild variant="secondary" className="w-full">
                        <a
                          href={promoterProgram.discordInviteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink />
                          {t("posters.create.discord")}
                        </a>
                      </Button>
                    </CardFooter>
                  </Card>
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="poster-placement-name">
                    {t("posters.create.placementName")}
                  </Label>
                  <Input
                    id="poster-placement-name"
                    data-testid="poster-placement-name"
                    value={placementName}
                    onChange={(event) => setPlacementName(event.target.value)}
                    placeholder={t("posters.create.placementPlaceholder")}
                    maxLength={120}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="poster-copy-count">
                    {t("posters.create.copies")}
                  </Label>
                  <Input
                    id="poster-copy-count"
                    data-testid="poster-copy-count"
                    type="number"
                    min={1}
                    max={remainingSlots}
                    value={copies}
                    onChange={(event) => {
                      const nextCopies = Number.parseInt(
                        event.target.value || "1",
                        10,
                      );
                      if (Number.isNaN(nextCopies)) {
                        return;
                      }
                      setCopies(
                        Math.max(1, Math.min(remainingSlots, nextCopies)),
                      );
                    }}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("posters.create.slotsRemaining", {
                      count: remainingSlots,
                    })}
                  </p>
                </div>
              </div>

              <Alert variant="info">
                <QrCode />
                <AlertTitle>{t("posters.create.oneLocationTitle")}</AlertTitle>
                <AlertDescription>
                  {t("posters.create.oneLocationDescription")}
                </AlertDescription>
              </Alert>

              {createPosters.error && (
                <p className="text-sm text-destructive" role="status">
                  {getApiErrorMessage(
                    createPosters.error,
                    t("posters.create.error"),
                  )}
                </p>
              )}

              <div className="flex justify-end">
                <LoadingButton
                  type="submit"
                  isLoading={createPosters.isPending}
                  disabled={
                    !selectedTemplate ||
                    !placementName.trim() ||
                    copies < 1 ||
                    copies > remainingSlots
                  }
                  data-testid="poster-create-submit"
                >
                  <QrCode />
                  {t("posters.create.submit")}
                </LoadingButton>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
