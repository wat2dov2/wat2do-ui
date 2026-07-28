import { useMemo, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useTranslation } from "react-i18next";

import { useCreatePromoterPosters } from "@/features/posters/hooks/usePromoterDashboard";
import { PosterDownloadMenu } from "@/features/posters/components/PosterDownloadMenu";
import type { ApprovedPosterTemplate, QRCode } from "@/features/posters/types";
import {
  generateAssetPdf,
  generateAssetPngs,
  sanitizeFilename,
} from "@/features/posters/utils/generateAssetPdf";
import { promoterProgram } from "@/shared/config/promoterProgram";
import {
  FormActions,
  DialogBody,
  FormGrid,
  FormLayout,
  FormSection,
  Stack,
} from "@/shared/layout";
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
import { ExternalLink, Plus, QrCode } from "@/shared/ui/doodle-icons";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
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
    <Stack gap={2}>
      <div className="relative aspect-[8.5/11] overflow-hidden rounded-lg border border-border bg-secondary">
        <img
          src={template.assetPath}
          alt={template.name}
          className="h-full w-full object-contain"
        />
        <Stack
          align="center"
          justify="center"
          className="absolute bg-background"
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
        </Stack>
      </div>
      <p className="truncate text-xs font-medium text-foreground">
        {poster.name}
      </p>
    </Stack>
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
        name: selectedTemplate.name,
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
          name: selectedTemplate.name,
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
      downloadBlob(blob, `${sanitizeFilename(selectedTemplate.name)}.pdf`);
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
          name: selectedTemplate.name,
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
            `${sanitizeFilename(selectedTemplate.name)}-copy-${index + 1}.png`,
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
        <DialogContent size="xl" scrollable>
          <DialogHeader>
            <DialogTitle>{t("posters.create.title")}</DialogTitle>
            <DialogDescription>
              {t("posters.create.description")}
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            {createdPosters.length > 0 && selectedTemplate ? (
              <Stack gap={6} data-testid="poster-created-previews">
                <Alert variant="success">
                  <QrCode />
                  <AlertTitle>{t("posters.create.createdTitle")}</AlertTitle>
                  <AlertDescription>
                    {t("posters.create.createdDescription", {
                      count: createdPosters.length,
                    })}
                  </AlertDescription>
                </Alert>
                <FormGrid columns={3}>
                  {createdPosters.map((poster) => (
                    <PosterPreview
                      key={poster.id}
                      poster={poster}
                      template={selectedTemplate}
                    />
                  ))}
                </FormGrid>
                <Stack direction="horizontal" justify="end" wrap gap={2}>
                  <PosterDownloadMenu
                    isLoading={isDownloading}
                    onDownload={(format) => {
                      void (format === "pdf" ? downloadPdf() : downloadPngs());
                    }}
                    testId="poster-batch-download"
                  />
                </Stack>
              </Stack>
            ) : (
              <FormLayout onSubmit={handleSubmit}>
                <FormSection
                  title={t("posters.create.chooseTemplate")}
                  description={t("posters.create.chooseTemplateDescription")}
                >
                  <FormGrid columns={3} data-testid="poster-template-gallery">
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
                          <Stack grow>
                            <Button
                              type="button"
                              variant="secondary"
                              selected={selectedTemplate?.id === template.id}
                              onClick={() => setSelectedTemplateId(template.id)}
                            >
                              {t("posters.create.selectTemplate")}
                            </Button>
                          </Stack>
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
                        <Stack grow>
                          <Button asChild variant="secondary">
                            <a
                              href={promoterProgram.discordInviteUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink />
                              {t("posters.create.discord")}
                            </a>
                          </Button>
                        </Stack>
                      </CardFooter>
                    </Card>
                  </FormGrid>
                </FormSection>

                <Field>
                  <FieldLabel htmlFor="poster-copy-count">
                    {t("posters.create.copies")}
                  </FieldLabel>
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
                  <FieldDescription>
                    {t("posters.create.slotsRemaining", {
                      count: remainingSlots,
                    })}
                  </FieldDescription>
                </Field>

                {createPosters.error && (
                  <FieldError role="status">
                    {getApiErrorMessage(
                      createPosters.error,
                      t("posters.create.error"),
                    )}
                  </FieldError>
                )}

                <FormActions>
                  <LoadingButton
                    type="submit"
                    isLoading={createPosters.isPending}
                    disabled={
                      !selectedTemplate || copies < 1 || copies > remainingSlots
                    }
                    data-testid="poster-create-submit"
                  >
                    {t("posters.create.submit")}
                  </LoadingButton>
                </FormActions>
              </FormLayout>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
