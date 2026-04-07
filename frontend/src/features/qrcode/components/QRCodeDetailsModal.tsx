/**
 * Poster details modal – view only: name, image, QR preview, stats, and chart data.
 * No editing, no Save, no Download QR button.
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { Eye, Megaphone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { useQRCodeScans } from "@/features/qrcode/hooks/useQRCodeScans";
import { useQRCodeStats } from "@/features/qrcode/hooks/useQRCodeStats";
import { QRCodeStatsDisplay } from "@/features/qrcode/components/QRCode/QRCodeStatsDisplay";
import { QRCodeScansChart } from "@/features/qrcode/components/QRCode/QRCodeScansChart";
import type { QRCode, Event } from "@/shared/types";
import { generateQRCodeUrl } from "@/shared/utils/qrGenerator";
import { API_BASE_URL } from "@/shared/config/api";
import { stripTrailingSlash } from "@/shared/utils/string";
import {
  QRCodeDetailsModalProvider,
  useQRCodeDetailsModalContext,
} from "@/features/qrcode/contexts/QRCodeDetailsModal.context";
import { useModalState } from "@/shared/hooks/useModalState";
import { ModalContentWrapper, EmptyState } from "@/shared/ui/modal-components";

interface QRCodeDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  qrCode: QRCode;
  events: Event[];
}

function QRCodeDetailsModalContent() {
  const { t } = useTranslation();
  const { isOpen, onClose, qrCode } = useQRCodeDetailsModalContext();
  const qrCodeScans = useQRCodeScans({ qrCode, isOpen });
  const qrCodeStats = useQRCodeStats({
    scans: qrCodeScans.scans,
    timeRange: qrCodeScans.timeRange,
  });

  const modalState = useModalState({
    onClose,
    resetOnClose: true,
    resetFn: () => {},
  });

  const qrUrl = generateQRCodeUrl(qrCode.id);
  const posterImageSrc = qrCode.imageUrl
    ? qrCode.imageUrl.startsWith("http") || qrCode.imageUrl.startsWith("data:")
      ? qrCode.imageUrl
      : `${stripTrailingSlash(API_BASE_URL)}${qrCode.imageUrl.startsWith("/") ? qrCode.imageUrl : `/${qrCode.imageUrl}`}`
    : undefined;

  const qrSize = 120;
  const qrPadding = 8;
  const previewSize = qrSize + qrPadding * 2;

  return (
    <Dialog open={isOpen} onOpenChange={modalState.handleOpenChange}>
      <DialogContent className="p-0 max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle className="text-lg font-semibold">{qrCode.name}</DialogTitle>
        </DialogHeader>

        <ModalContentWrapper className="overflow-y-auto flex-1 min-h-0">
          <div className="space-y-6">
            {/* Poster image + QR preview: same outer size, QR has padding so it isn't cropped */}
            <div className="flex items-start gap-4">
              <div
                className="shrink-0 rounded-lg overflow-hidden border border-border bg-muted"
                style={{ width: previewSize, height: previewSize }}
              >
                {posterImageSrc ? (
                  <img
                    src={posterImageSrc}
                    alt={qrCode.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground/50">
                    <Megaphone className="w-10 h-10" />
                  </div>
                )}
              </div>
              <div
                className="shrink-0 rounded-lg border border-border bg-white flex items-center justify-center overflow-visible"
                style={{ width: previewSize, height: previewSize, padding: qrPadding }}
              >
                <QRCodeSVG value={qrUrl} size={qrSize} className="shrink-0" />
              </div>
              <div className="min-w-0 flex-1">
                {/* Description intentionally hidden: posters are view-only and copy is managed elsewhere */}
              </div>
            </div>

            {/* Stats */}
            <QRCodeStatsDisplay
              totalScans={qrCodeStats.stats.totalScans}
              uniqueScans={qrCodeStats.stats.uniqueScans}
            />

            {/* Chart */}
            {qrCodeStats.stats.totalScansData && qrCodeStats.stats.totalScansData.length > 0 ? (
              <QRCodeScansChart
                timeRange={qrCodeScans.timeRange}
                onTimeRangeChange={qrCodeScans.setTimeRange}
                totalScansData={qrCodeStats.stats.totalScansData}
                uniqueScansData={qrCodeStats.stats.uniqueScansData}
                hideTimeRangeSelector
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
