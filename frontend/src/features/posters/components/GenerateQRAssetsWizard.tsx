import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { QrCode, ArrowLeft, ArrowRight, Download } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { ImageUploadField } from "@/shared/ui/image-upload-field";
import { QRPlacementOverlay } from "./QRPlacementOverlay";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldError,
} from "@/shared/ui/field";
import { useCreatePoster } from "@/features/posters/hooks/useCreatePoster";
import { generateAssetPdf, sanitizeFilename } from "@/features/posters/utils/generateAssetPdf";
import { Spinner } from "@/shared/ui/spinner";

type WizardStep = 1 | 2 | 3;

interface PlacementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Image rect inside a container when using object-fit: contain (same aspect-fit as PDF). */
function getImageRectInContainer(
  containerW: number,
  containerH: number,
  imageW: number,
  imageH: number
): { x: number; y: number; width: number; height: number } {
  if (containerW <= 0 || containerH <= 0 || imageW <= 0 || imageH <= 0) {
    return { x: 0, y: 0, width: containerW, height: containerH };
  }
  const containerRatio = containerW / containerH;
  const imgRatio = imageW / imageH;
  let drawW: number;
  let drawH: number;
  if (imgRatio > containerRatio) {
    drawW = containerW;
    drawH = containerW / imgRatio;
  } else {
    drawH = containerH;
    drawW = containerH * imgRatio;
  }
  const x = (containerW - drawW) / 2;
  const y = (containerH - drawH) / 2;
  return { x, y, width: drawW, height: drawH };
}

/** Convert placement from image-relative (0–1 of image) to container-relative (0–1 of container) for overlay display. */
function placementImageToContainer(
  p: PlacementRect,
  imageRect: { x: number; y: number; width: number; height: number },
  containerW: number,
  containerH: number
): PlacementRect {
  if (containerW <= 0 || containerH <= 0) return p;
  return {
    x: (imageRect.x + p.x * imageRect.width) / containerW,
    y: (imageRect.y + p.y * imageRect.height) / containerH,
    width: (p.width * imageRect.width) / containerW,
    height: (p.height * imageRect.height) / containerH,
  };
}

/** Convert placement from container-relative (0–1 of container) to image-relative (0–1 of image) for storage and PDF. */
function placementContainerToImage(
  p: PlacementRect,
  imageRect: { x: number; y: number; width: number; height: number },
  containerW: number,
  containerH: number
): PlacementRect {
  if (imageRect.width <= 0 || imageRect.height <= 0) return p;
  const left = p.x * containerW;
  const top = p.y * containerH;
  const w = p.width * containerW;
  const h = p.height * containerH;
  const boxLeft = Math.max(left, imageRect.x);
  const boxTop = Math.max(top, imageRect.y);
  const boxRight = Math.min(left + w, imageRect.x + imageRect.width);
  const boxBottom = Math.min(top + h, imageRect.y + imageRect.height);
  return {
    x: (boxLeft - imageRect.x) / imageRect.width,
    y: (boxTop - imageRect.y) / imageRect.height,
    width: (boxRight - boxLeft) / imageRect.width,
    height: (boxBottom - boxTop) / imageRect.height,
  };
}

/** Default placement in image-relative space (same for all aspect ratios). */
const DEFAULT_IMAGE_PLACEMENT: PlacementRect = { x: 0.1, y: 0.1, width: 0.3, height: 0.3 };

interface QRAsset {
  id: string;
  file: File;
  imagePreview: string;
  name: string;
  quantity: number;
  placement?: PlacementRect;
}

interface GenerateQRAssetsWizardProps {
  onClose?: () => void;
  userEmail?: string;
}

export function GenerateQRAssetsWizard({ onClose, userEmail: userEmailProp }: GenerateQRAssetsWizardProps) {
  const { t } = useTranslation();
  const { resolveEmail, createPoster } = useCreatePoster();
  const userEmail = resolveEmail(userEmailProp);
  const [step, setStep] = useState<WizardStep>(1);
  const [assets, setAssets] = useState<QRAsset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ assets?: string; placement?: string }>({});
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const selectAsset = useCallback((assetId: string) => {
    setSelectedAssetId(assetId);
    setImageNaturalSize(null);
  }, []);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? assets[0],
    [assets, selectedAssetId]
  );

  const imageRectInContainer = useMemo(() => {
    const { width: cw, height: ch } = containerDimensions;
    const img = imageNaturalSize;
    if (!img) return { x: 0, y: 0, width: cw, height: ch };
    return getImageRectInContainer(cw, ch, img.width, img.height);
  }, [containerDimensions, imageNaturalSize]);

  const displayPlacement = useMemo(() => {
    const stored = selectedAsset?.placement ?? DEFAULT_IMAGE_PLACEMENT;
    const { width: cw, height: ch } = containerDimensions;
    if (cw <= 0 || ch <= 0) return stored;
    return placementImageToContainer(stored, imageRectInContainer, cw, ch);
  }, [selectedAsset?.placement, imageRectInContainer, containerDimensions]);

  const setPlacementForAsset = useCallback(
    (assetId: string, placement: QRAsset["placement"]) => {
      setAssets((prev) =>
        prev.map((asset) =>
          asset.id === assetId
            ? {
                ...asset,
                placement: placement ?? undefined,
              }
            : asset
        )
      );
      setErrors((prev) => ({ ...prev, placement: undefined }));
    },
    []
  );

  // Track container dimensions for overlay positioning
  useEffect(() => {
    const updateDimensions = () => {
      if (imageContainerRef.current) {
        const rect = imageContainerRef.current.getBoundingClientRect();
        setContainerDimensions({ width: rect.width, height: rect.height });
      }
    };

    updateDimensions();

    const resizeObserver = new ResizeObserver(updateDimensions);
    if (imageContainerRef.current) {
      resizeObserver.observe(imageContainerRef.current);
    }

    window.addEventListener("resize", updateDimensions);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateDimensions);
    };
  }, [step, selectedAsset]);

  const addAssetFromFile = useCallback((file: File, preview: string) => {
    setAssets((prev) => {
      const id = `${file.name}-${file.size}-${file.lastModified}`;
      if (prev.some((a) => a.id === id)) {
        return prev;
      }
      const next: QRAsset = {
        id,
        file,
        imagePreview: preview,
        name: file.name,
        quantity: 1,
        placement: DEFAULT_IMAGE_PLACEMENT,
      };
      return [...prev, next];
    });
    setErrors((prev) => ({ ...prev, assets: undefined }));
  }, []);

  const handleAssetsUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      if (!files.length) return;

      files.forEach((file) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            addAssetFromFile(file, reader.result);
          }
        };
        reader.readAsDataURL(file);
      });

      event.target.value = "";
    },
    [addAssetFromFile]
  );

  const handleRemoveAsset = useCallback((assetId: string) => {
    setAssets((prev) => prev.filter((a) => a.id !== assetId));
    setImageNaturalSize(null);
    setErrors((prev) => ({ ...prev, assets: undefined }));
  }, []);

  const handleQuantityChange = useCallback((assetId: string, value: string) => {
    const quantity = Number.parseInt(value || "0", 10);
    if (Number.isNaN(quantity)) return;
    setAssets((prev) =>
      prev.map((asset) =>
        asset.id === assetId
          ? {
              ...asset,
              quantity: Math.max(0, Math.min(999, quantity)),
            }
          : asset
      )
    );
  }, []);

  const canContinueFromStep1 = useMemo(
    () => assets.length > 0 && assets.some((asset) => asset.quantity > 0),
    [assets]
  );

  const goToStep2 = () => {
    if (!canContinueFromStep1) {
      setErrors((prev) => ({
        ...prev,
        assets: t("admin.qrAssets.errors.noAssetsOrQuantities"),
      }));
      return;
    }
    setErrors({});
    setStep(2);
    if (!selectedAssetId && assets[0]) {
      selectAsset(assets[0].id);
    }
  };

  const handlePlacementChange = (containerRelativePlacement: PlacementRect) => {
    if (!selectedAsset) return;
    const { width: cw, height: ch } = containerDimensions;
    if (cw <= 0 || ch <= 0) return;
    const imageRelative = placementContainerToImage(
      containerRelativePlacement,
      imageRectInContainer,
      cw,
      ch
    );
    setPlacementForAsset(selectedAsset.id, imageRelative);
  };

  const allAssetsHavePlacement = useMemo(
    () => assets.length > 0 && assets.every((asset) => !!asset.placement),
    [assets]
  );

  const goToStep3 = () => {
    if (!allAssetsHavePlacement) {
      setErrors((prev) => ({
        ...prev,
        placement: t("admin.qrAssets.errors.missingPlacement"),
      }));
      return;
    }
    setErrors({});
    setStep(3);
  };

  const handleGenerateAndDownload = async () => {
    if (!userEmail) {
      setPdfError(t("admin.qrAssets.errors.loginRequired") || "Please log in to generate PDFs.");
      return;
    }
    setPdfError(null);
    setPdfGenerating(true);
    const baseUrl = window.location.origin;
    try {
      for (const asset of assets) {
        if (!asset.placement) continue;
        const baseName = asset.name.replace(/\.[^.]+$/, "");
        const posters = await Promise.all(
          Array.from({ length: asset.quantity }, (_, i) =>
            createPoster({
              id: crypto.randomUUID(),
              name: asset.quantity > 1 ? `${baseName} - Page ${i + 1}` : baseName,
              description: null,
              destination_type: "events-list",
              destination_id: null,
              filters: null,
              image_url: null,
            })
          )
        );
        const posterIds = posters.map((p) => p.id);
        const blob = await generateAssetPdf(
          {
            imagePreview: asset.imagePreview,
            name: asset.name,
            quantity: asset.quantity,
            placement: asset.placement,
          },
          posterIds,
          baseUrl
        );
        const filename = `${sanitizeFilename(asset.name)}.pdf`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("PDF generation failed:", err);
      setPdfError(err instanceof Error ? err.message : String(err));
    } finally {
      setPdfGenerating(false);
    }
  };

  const headerTitle =
    step === 1
      ? t("admin.qrAssets.step1Title")
      : step === 2
      ? t("admin.qrAssets.step2Title")
      : t("admin.qrAssets.step3Title");

  const headerDescription =
    step === 1
      ? t("admin.qrAssets.step1Description")
      : step === 2
      ? t("admin.qrAssets.step2Description")
      : t("admin.qrAssets.step3Description");

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="size-12 rounded-full bg-primary/20 flex items-center justify-center">
          <QrCode className="size-6 text-primary" />
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-semibold text-foreground">{headerTitle}</h2>
          <p className="text-sm text-muted-foreground">{headerDescription}</p>
        </div>
      </div>

      {step === 1 && (
        <div className="space-y-5">
          <FieldGroup>
            <FieldSet>
              <div className="mt-3 grid gap-3">
                <div className="border border-dashed border-border rounded-xl p-4 bg-secondary/40">
                  <ImageUploadField
                    label={t("admin.qrAssets.uploadFieldLabel")}
                    imagePreview={null}
                    onImageUpload={handleAssetsUpload}
                    onRemoveImage={() => {}}
                    multiple={true}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("admin.qrAssets.uniqueAssetsHelper")}
                </p>
              </div>
            </FieldSet>
          </FieldGroup>

          <div className="border border-border rounded-xl p-4 bg-card space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">
                {t("admin.qrAssets.assetsGridTitle")}
              </h3>
              <span className="text-xs text-muted-foreground">
                {t("admin.qrAssets.assetsCount", { count: assets.length })}
              </span>
            </div>
            {assets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("admin.qrAssets.noAssetsYet")}
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {assets.map((asset) => (
                  <div
                    key={asset.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-secondary/40 p-3"
                  >
                    <div className="size-20 rounded-md overflow-hidden bg-secondary flex items-center justify-center">
                      <img
                        src={asset.imagePreview}
                        alt={asset.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-xs font-medium text-foreground truncate">
                        {asset.name}
                      </p>
                      <Field>
                        <FieldLabel className="text-[11px] text-muted-foreground">
                          {t("admin.qrAssets.quantityLabel")}
                        </FieldLabel>
                        <Input
                          type="number"
                          min={0}
                          max={999}
                          value={asset.quantity.toString()}
                          onChange={(e) =>
                            handleQuantityChange(asset.id, e.target.value)
                          }
                          className="h-8 text-xs"
                        />
                      </Field>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      onClick={() => handleRemoveAsset(asset.id)}
                    >
                      <span className="sr-only">{t("common.delete")}</span>
                      ×
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {errors.assets && (
              <FieldError className="text-xs mt-2">{errors.assets}</FieldError>
            )}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="flex gap-3 overflow-x-auto pb-1">
            {assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => selectAsset(asset.id)}
                className={`rounded-lg border px-2 py-1 text-xs shrink-0 ${
                  selectedAsset?.id === asset.id
                    ? "border-primary bg-primary/10 text-primary-foreground"
                    : "border-border bg-secondary text-foreground"
                }`}
              >
                {asset.name}
              </button>
            ))}
          </div>
          <div className="border border-border rounded-xl p-4 bg-card">
            {selectedAsset ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {t("admin.qrAssets.drawPlacementHelper")}
                </p>
                <div
                  ref={imageContainerRef}
                  className="relative w-full max-w-md mx-auto aspect-3/4 rounded-lg overflow-hidden border border-border bg-secondary select-none"
                >
                  <img
                    src={selectedAsset.imagePreview}
                    alt={selectedAsset.name}
                    className="w-full h-full object-contain"
                    draggable={false}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      setImageNaturalSize({
                        width: img.naturalWidth,
                        height: img.naturalHeight,
                      });
                    }}
                  />
                  {containerDimensions.width > 0 && containerDimensions.height > 0 && (
                    <QRPlacementOverlay
                      placement={displayPlacement}
                      onPlacementChange={handlePlacementChange}
                      containerRef={imageContainerRef}
                      imageWidth={containerDimensions.width}
                      imageHeight={containerDimensions.height}
                    />
                  )}
                </div>
                {errors.placement && (
                  <FieldError className="text-xs mt-2">
                    {errors.placement}
                  </FieldError>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("admin.qrAssets.noSelectedAsset")}
              </p>
            )}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="border border-border rounded-xl p-4 bg-card space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("admin.qrAssets.reviewSummary")}
            </p>
            <div className="space-y-2">
              {assets.map((asset) => (
                <div
                  key={asset.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="size-8 rounded-md overflow-hidden bg-secondary flex items-center justify-center">
                      <img
                        src={asset.imagePreview}
                        alt={asset.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">
                        {asset.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {t("admin.qrAssets.summaryPerAsset", {
                          count: asset.quantity,
                        })}
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {t("admin.qrAssets.summaryPagesLabel", {
                      count: asset.quantity,
                    })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-border">
        <div className="flex items-center gap-2">
          {step > 1 ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setStep((prev) => (prev === 1 ? 1 : ((prev - 1) as WizardStep)))}
            >
              <ArrowLeft className="size-3 mr-1" />
              {t("common.back")}
            </Button>
          ) : (
            onClose && (
              <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                {t("common.cancel")}
              </Button>
            )
          )}
        </div>
        <div className="flex items-center gap-2">
          {step < 3 && (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (step === 1) {
                  goToStep2();
                } else if (step === 2) {
                  goToStep3();
                }
              }}
            >
              {t("common.continue")}
              <ArrowRight className="size-3 ml-1" />
            </Button>
          )}
          {step === 3 && (
            <>
              {pdfError && (
                <FieldError className="text-xs mr-2">{pdfError}</FieldError>
              )}
              <Button
                type="button"
                size="sm"
                onClick={handleGenerateAndDownload}
                disabled={pdfGenerating}
              >
                {pdfGenerating ? (
                  <>
                    <Spinner className="size-3 mr-1" />
                    {t("common.pleaseWait")}
                  </>
                ) : (
                  <>
                    <Download className="size-3 mr-1" />
                    {t("admin.qrAssets.downloadAllPdfs")}
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
