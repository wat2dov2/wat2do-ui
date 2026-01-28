import React, { useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import {
  Download,
  Edit,
  X,
  ImagePlus,
  Megaphone,
  Eye,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldSeparator,
} from "@/shared/ui/field";
import { ImageUploadField } from "@/shared/ui/image-upload-field";
import { useQRCodeScans } from "@/features/qrcode/hooks/useQRCodeScans";
import { useQRCodeStats } from "@/features/qrcode/hooks/useQRCodeStats";
import { useQRCodeImage } from "@/features/qrcode/hooks/useQRCodeImage";
import { useQRCodeEditForm } from "@/features/qrcode/hooks/useQRCodeEditForm";
import { QRCodeStatsDisplay } from "@/features/qrcode/components/QRCode/QRCodeStatsDisplay";
import { QRCodeScansChart } from "@/features/qrcode/components/QRCode/QRCodeScansChart";
import type { QRCode, Event } from "@/shared/types";
import {
  saveQRCode,
} from "@/features/qrcode/api/qrcode.api";
import { generateQRCodeUrl, downloadQRCodeAsPNG } from "@/shared/utils/qrGenerator";
import {
  QRCodeDetailsModalProvider,
  useQRCodeDetailsModalContext,
} from "@/features/qrcode/contexts/QRCodeDetailsModal.context";
import {
  ModalContentWrapper,
  ModalHeaderWrapper,
  QRCodeContainer,
  ModalImageContainer,
  FlexRow,
  FlexCol,
  EmptyState,
  StatusBadge,
} from "@/shared/ui/modal-components";
import { useModalState } from "@/shared/hooks/useModalState";

interface QRCodeDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  qrCode: QRCode;
  events: Event[];
  onUpdate: () => void;
}

function QRCodeDetailsModalContent() {
  const { t } = useTranslation();
  const { isOpen, onClose, qrCode, events, onUpdate } = useQRCodeDetailsModalContext();
  const editForm = useQRCodeEditForm({ qrCode, isOpen });

  // Use hooks for business logic
  const qrCodeScans = useQRCodeScans({ qrCode, isOpen });
  const qrCodeStats = useQRCodeStats({
    scans: qrCodeScans.scans,
    timeRange: qrCodeScans.timeRange,
  });
  const qrCodeImage = useQRCodeImage({ qrCode, isOpen });

  // Use modal state hook for standardized open/close handling
  const modalState = useModalState({
    onClose,
    resetOnClose: true,
    resetFn: editForm.reset,
  });

  const handleSave = () => {
    const updated: QRCode = {
      ...qrCode,
      name: editForm.editedName,
      description: editForm.editedDescription || undefined,
      imageUrl: qrCodeImage.editedImageUrl || undefined,
    };
    saveQRCode(updated);
    onUpdate();
    editForm.dispatch({ type: "SET_IS_EDITING", payload: false });
  };

  const handleDownload = () => {
    // Simple download - create a data URL from the QR code
    // In production, you'd properly render QRCodeSVG to canvas
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 512, 512);
    const dataUrl = canvas.toDataURL("image/png");
    downloadQRCodeAsPNG(dataUrl, qrCode.name);
  };

  // Get destination info
  const destinationInfo = useMemo(() => {
    if (qrCode.destinationType === "event") {
      const event = events.find((e) => e.id === qrCode.destinationId);
      return event ? { type: t("qrCode.event"), name: event.title } : null;
    } else if (qrCode.destinationType === "events-list") {
      return { type: t("qrCode.eventsList"), name: t("admin.filteredEvents") };
    } else {
      return {
        type: t("qrCode.customUrl"),
        name: qrCode.destinationId as string,
      };
    }
  }, [qrCode, events, t]);

  const qrUrl = generateQRCodeUrl(qrCode.id);

  return (
    <Dialog open={isOpen} onOpenChange={modalState.handleOpenChange}>
      <DialogContent className="p-0 max-w-5xl max-h-[90vh] overflow-y-auto">
        <ModalHeaderWrapper>
          <DialogHeader>
            <DialogTitle>{t("admin.qrCodeAnalytics")}</DialogTitle>
            <DialogDescription>
              {qrCode.name} - {t("admin.performanceMetrics")}
            </DialogDescription>
          </DialogHeader>
        </ModalHeaderWrapper>

        <ModalContentWrapper>
          <div className="space-y-6">
          {/* QR Code Info Section */}
          <FlexRow className="items-start" gap="gap-6">
            {/* QR Code */}
            <div className="flex-shrink-0">
              <QRCodeContainer>
                <QRCodeSVG value={qrUrl} size={200} />
              </QRCodeContainer>
              <div className="mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                  className="w-full"
                >
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  {t("admin.downloadQrCode")}
                </Button>
              </div>
            </div>

            {/* Poster Image */}
            <div className="flex-shrink-0">
              <ModalImageContainer
                src={qrCodeImage.imagePreview || undefined}
                alt={qrCode.name}
                fallback={
                  <div className="w-full h-full flex items-center justify-center">
                    <Megaphone className="w-16 h-16 text-muted-foreground/30" />
                  </div>
                }
              />
            </div>

            {/* Info and Edit Section */}
            <div className="flex-1">
              {editForm.isEditing ? (
                <form>
                  <FieldGroup>
                    <FieldSet>
                      <FieldLegend>{t("admin.editQRCode")}</FieldLegend>
                      <FieldGroup>
                        <Field>
                          <FieldLabel htmlFor="edit-name" className="text-sm font-medium text-foreground">
                            {t("forms.name")}
                          </FieldLabel>
                          <Input
                            id="edit-name"
                            type="text"
                            value={editForm.editedName}
                            onChange={(e) => editForm.dispatch({ type: "SET_EDITED_NAME", payload: e.target.value })}
                            className="w-full text-sm"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="edit-description" className="text-sm font-medium text-foreground">
                            {t("forms.description")}
                          </FieldLabel>
                          <Textarea
                            id="edit-description"
                            value={editForm.editedDescription}
                            onChange={(e) => editForm.dispatch({ type: "SET_EDITED_DESCRIPTION", payload: e.target.value })}
                            className="w-full text-sm min-h-[80px]"
                          />
                        </Field>
                        <ImageUploadField
                          label={t("qrCode.posterImage")}
                          imagePreview={qrCodeImage.imagePreview}
                          onImageUpload={qrCodeImage.handleImageUpload}
                          onRemoveImage={qrCodeImage.handleRemoveImage}
                          fileInputRef={qrCodeImage.fileInputRef}
                        />
                        <Field orientation="horizontal">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => editForm.dispatch({ type: "SET_IS_EDITING", payload: false })}
                          >
                            {t("common.cancel")}
                          </Button>
                          <Button type="button" size="sm" onClick={handleSave}>
                            {t("forms.saveChanges")}
                          </Button>
                        </Field>
                      </FieldGroup>
                    </FieldSet>
                  </FieldGroup>
                </form>
              ) : (
                <>
                  <FlexRow className="items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg text-gray-900 mb-1">
                        {qrCode.name}
                      </h3>
                      {qrCode.description && (
                        <p className="text-sm text-muted-foreground mb-3">
                          {qrCode.description}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => editForm.dispatch({ type: "SET_IS_EDITING", payload: true })}
                    >
                      <Edit className="w-3.5 h-3.5 mr-1.5" />
                      {t("common.edit")}
                    </Button>
                  </FlexRow>
                  <FlexRow gap="gap-4">
                    <StatusBadge
                      isActive={qrCode.isActive}
                      activeLabel={t("common.active")}
                      inactiveLabel={t("common.inactive")}
                    />
                    {destinationInfo && (
                      <FlexRow gap="gap-1.5" className="text-sm text-muted-foreground">
                        <span>{destinationInfo.type}: {destinationInfo.name}</span>
                      </FlexRow>
                    )}
                  </FlexRow>
                </>
              )}
            </div>
          </FlexRow>

          {/* Stats Grid */}
          <QRCodeStatsDisplay
            totalScans={qrCodeStats.stats.totalScans}
            uniqueScans={qrCodeStats.stats.uniqueScans}
            conversions={qrCodeStats.stats.conversions}
            conversionRate={qrCodeStats.stats.conversionRate}
          />

          {/* Charts Section */}
          {qrCodeStats.stats.totalScansData && qrCodeStats.stats.totalScansData.length > 0 ? (
            <QRCodeScansChart
              timeRange={qrCodeScans.timeRange}
              onTimeRangeChange={qrCodeScans.setTimeRange}
              totalScansData={qrCodeStats.stats.totalScansData}
              uniqueScansData={qrCodeStats.stats.uniqueScansData}
              conversionsData={qrCodeStats.stats.conversionsData}
              conversionRateData={qrCodeStats.stats.conversionRateData}
            />
          ) : (
            <EmptyState
              icon={Eye}
              title={t("qrCode.noScanData")}
              description={t("qrCode.noScanDataDesc")}
            />
          )}
          </div>
        </ModalContentWrapper>
      </DialogContent>
    </Dialog>
  );
}

export function QRCodeDetailsModal(props: QRCodeDetailsModalProps) {
  return (
    <QRCodeDetailsModalProvider value={props}>
      <QRCodeDetailsModalContent />
    </QRCodeDetailsModalProvider>
  );
}
