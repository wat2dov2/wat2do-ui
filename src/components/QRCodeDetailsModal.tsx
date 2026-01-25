import React, { useState, useMemo } from "react";
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
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldSeparator,
} from "./ui/field";
import { useQRCodeScans } from "@/hooks/useQRCodeScans";
import { useQRCodeStats } from "@/hooks/useQRCodeStats";
import { useQRCodeImage } from "@/hooks/useQRCodeImage";
import { QRCodeStatsDisplay } from "./QRCode/QRCodeStatsDisplay";
import { QRCodeScansChart } from "./QRCode/QRCodeScansChart";
import type { QRCode, Event } from "@/types";
import {
  saveQRCode,
} from "@/utils/qrRedirect";
import { generateQRCodeUrl, downloadQRCodeAsPNG } from "@/utils/qrGenerator";

interface QRCodeDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  qrCode: QRCode;
  events: Event[];
  onUpdate: () => void;
}

export function QRCodeDetailsModal({
  isOpen,
  onClose,
  qrCode,
  events,
  onUpdate,
}: QRCodeDetailsModalProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState(qrCode.name);
  const [editedDescription, setEditedDescription] = useState(qrCode.description || "");

  // Use hooks for business logic
  const qrCodeScans = useQRCodeScans({ qrCode, isOpen });
  const qrCodeStats = useQRCodeStats({
    scans: qrCodeScans.scans,
    timeRange: qrCodeScans.timeRange,
  });
  const qrCodeImage = useQRCodeImage({ qrCode, isOpen });

  // Reset edit state when modal opens
  React.useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        setEditedName(qrCode.name);
        setEditedDescription(qrCode.description || "");
        setIsEditing(false);
      });
    }
  }, [isOpen, qrCode]);

  const handleSave = () => {
    const updated: QRCode = {
      ...qrCode,
      name: editedName,
      description: editedDescription || undefined,
      imageUrl: qrCodeImage.editedImageUrl || undefined,
    };
    saveQRCode(updated);
    onUpdate();
    setIsEditing(false);
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
        type: t("qrCode.customUrlType"),
        name: qrCode.destinationId as string,
      };
    }
  }, [qrCode, events, t]);

  const qrUrl = generateQRCodeUrl(qrCode.id);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
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
              {isEditing ? (
                <form>
                  <FieldGroup>
                    <FieldSet>
                      <FieldLegend>Edit QR Code</FieldLegend>
                      <FieldGroup>
                        <Field>
                          <FieldLabel htmlFor="edit-name" className="text-sm font-medium text-foreground">
                            {t("forms.name")}
                          </FieldLabel>
                          <Input
                            id="edit-name"
                            type="text"
                            value={editedName}
                            onChange={(e) => setEditedName(e.target.value)}
                            className="w-full text-sm"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="edit-description" className="text-sm font-medium text-foreground">
                            {t("forms.description")}
                          </FieldLabel>
                          <Textarea
                            id="edit-description"
                            value={editedDescription}
                            onChange={(e) => setEditedDescription(e.target.value)}
                            className="w-full text-sm min-h-[80px]"
                          />
                        </Field>
                        <Field>
                          <FieldLabel className="text-sm font-medium text-foreground">
                            {t("qrCode.posterImage")}
                          </FieldLabel>
                          <input
                            ref={qrCodeImage.fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={qrCodeImage.handleImageUpload}
                            className="hidden"
                          />
                          {qrCodeImage.imagePreview ? (
                            <div className="relative">
                              <div className="relative w-full h-48 rounded-xl overflow-hidden border border-border">
                                <img
                                  src={qrCodeImage.imagePreview}
                                  alt={t("qrCode.posterPreview")}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={qrCodeImage.handleRemoveImage}
                                className="absolute top-2 right-2"
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => qrCodeImage.fileInputRef.current?.click()}
                              className="w-full border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-primary transition-colors cursor-pointer bg-muted/50 hover:bg-muted"
                            >
                              <ImagePlus className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                              <p className="text-sm font-medium text-foreground mb-1">
                                {t("forms.clickToUploadImage")}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {t("qrCode.imageFormat")}
                              </p>
                            </button>
                          )}
                        </Field>
                        <Field orientation="horizontal">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setIsEditing(false)}
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
                      onClick={() => setIsEditing(true)}
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
