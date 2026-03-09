import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { QrCode, Info, ArrowLeft, ArrowRight, Download } from "lucide-react";
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

type WizardStep = 1 | 2 | 3;

interface QRAsset {
  id: string;
  file: File;
  imagePreview: string;
  name: string;
  quantity: number;
  placement?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface GenerateQRAssetsWizardProps {
  onClose?: () => void;
}

export function GenerateQRAssetsWizard({ onClose }: GenerateQRAssetsWizardProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<WizardStep>(1);
  const [assets, setAssets] = useState<QRAsset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ assets?: string; placement?: string }>({});
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? assets[0],
    [assets, selectedAssetId]
  );

  const defaultPlacement = useMemo(() => {
    // Create a pixel-square default (works even if container isn't square)
    const { width, height } = containerDimensions;
    if (width <= 0 || height <= 0) {
      return { x: 0.1, y: 0.1, width: 0.3, height: 0.3 };
    }

    const sizePx = 0.3 * Math.min(width, height);
    const placementWidth = sizePx / width;
    const placementHeight = sizePx / height;
    return { x: 0.1, y: 0.1, width: placementWidth, height: placementHeight };
  }, [containerDimensions]);

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

  // Ensure every asset has a placement once we can measure the container.
  // This avoids "continue" being blocked while still showing no square.
  useEffect(() => {
    if (step !== 2) return;
    if (containerDimensions.width <= 0 || containerDimensions.height <= 0) return;

    setAssets((prev) => {
      if (prev.every((a) => !!a.placement)) return prev;
      return prev.map((asset) =>
        asset.placement ? asset : { ...asset, placement: defaultPlacement }
      );
    });
  }, [step, containerDimensions, defaultPlacement]);

  // Initialize default placement when asset is selected (guarantee selected shows a square)
  useEffect(() => {
    if (step !== 2) return;
    if (!selectedAsset || selectedAsset.placement) return;
    if (containerDimensions.width <= 0 || containerDimensions.height <= 0) return;

    setPlacementForAsset(selectedAsset.id, defaultPlacement);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedAsset?.id, containerDimensions, defaultPlacement, setPlacementForAsset]);

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
      setSelectedAssetId(assets[0].id);
    }
  };

  const handlePlacementChange = (placement: QRAsset["placement"]) => {
    if (!selectedAsset) return;
    setPlacementForAsset(selectedAsset.id, placement);
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
    // This will be implemented using a dedicated PDF utility.
    // For now, we only show a placeholder so the UI is wired.
    // eslint-disable-next-line no-alert
    alert(t("admin.qrAssets.pdfGenerationComingSoon"));
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
        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
          <QrCode className="w-6 h-6 text-primary" />
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-semibold text-gray-900">{headerTitle}</h2>
          <p className="text-sm text-muted-foreground">{headerDescription}</p>
        </div>
      </div>

      {step === 1 && (
        <div className="space-y-5">
          <FieldGroup>
            <FieldSet>
              <div className="mt-3 grid gap-3">
                <div className="border border-dashed border-border rounded-xl p-4 bg-muted/40">
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
              <h3 className="text-sm font-medium text-gray-900">
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
                    className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3"
                  >
                    <div className="w-20 h-20 rounded-md overflow-hidden bg-muted flex items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={asset.imagePreview}
                        alt={asset.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-xs font-medium text-gray-900 truncate">
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
                      variant="ghost"
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
                onClick={() => setSelectedAssetId(asset.id)}
                className={`rounded-lg border px-2 py-1 text-xs shrink-0 ${
                  selectedAsset?.id === asset.id
                    ? "border-primary bg-primary/10 text-primary-foreground"
                    : "border-border bg-muted text-foreground"
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
                  className="relative w-full max-w-md mx-auto aspect-3/4 rounded-lg overflow-hidden border border-border bg-muted select-none"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selectedAsset.imagePreview}
                    alt={selectedAsset.name}
                    className="w-full h-full object-contain"
                    draggable={false}
                  />
                  {containerDimensions.width > 0 && containerDimensions.height > 0 && (
                    <QRPlacementOverlay
                      placement={selectedAsset.placement ?? defaultPlacement}
                      onPlacementChange={(placement) =>
                        setPlacementForAsset(selectedAsset.id, placement)
                      }
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
                  className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-md overflow-hidden bg-muted flex items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={asset.imagePreview}
                        alt={asset.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-900 truncate">
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
              variant="ghost"
              size="sm"
              onClick={() => setStep((prev) => (prev === 1 ? 1 : ((prev - 1) as WizardStep)))}
            >
              <ArrowLeft className="w-3 h-3 mr-1" />
              {t("common.back")}
            </Button>
          ) : (
            onClose && (
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
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
              <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          )}
          {step === 3 && (
            <Button
              type="button"
              size="sm"
              onClick={handleGenerateAndDownload}
            >
              <Download className="w-3 h-3 mr-1" />
              {t("admin.qrAssets.downloadAllPdfs")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
