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

  // Handle dialog open change - reset form when opening
  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (open) {
      editForm.reset();
    } else {
      onClose();
    }
  }, [editForm, onClose]);

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
    <Dialog open={isOpen} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="p-0 max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle>{t("admin.qrCodeAnalytics")}</DialogTitle>
          <DialogDescription>
            {qrCode.name} - {t("admin.performanceMetrics")}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6">
          <div className="space-y-6">
          {/* QR Code Info Section */}
          <div className="flex items-start gap-6">
            {/* QR Code */}
            <div className="flex-shrink-0">
              <div className="p-4 bg-white rounded-lg border border-border">
                <QRCodeSVG value={qrUrl} size={200} />
              </div>
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
              <div className="w-64 h-64 rounded-lg overflow-hidden border border-border bg-gradient-to-br from-primary/20 to-primary/5">
                {qrCodeImage.imagePreview ? (
                  <img
                    src={qrCodeImage.imagePreview}
                    alt={qrCode.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Megaphone className="w-16 h-16 text-muted-foreground/30" />
                  </div>
                )}
              </div>
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
                  <div className="flex items-start justify-between">
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
                  </div>
                  <div className="flex items-center gap-4">
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
                        qrCode.isActive
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      {qrCode.isActive ? t("common.active") : t("common.inactive")}
                    </span>
                    {destinationInfo && (
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <span>{destinationInfo.type}: {destinationInfo.name}</span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

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
            <div className="text-center py-12 text-muted-foreground border border-border rounded-xl">
              <Eye className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium mb-1">{t("qrCode.noScanData")}</p>
              <p className="text-sm">{t("qrCode.scanQRCodeToSeeData")}</p>
            </div>
          )}
          </div>
        </div>
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
