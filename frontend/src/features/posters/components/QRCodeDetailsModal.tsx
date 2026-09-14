/**
 * Poster details modal – view only: name, image, QR preview, stats, and chart data.
 * No editing, no Save, no Download QR button.
 */

import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { Eye, Megaphone } from "@/shared/ui/doodle-icons";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import { useQRCodeScans } from "@/features/posters/hooks/useQRCodeScans";
import { useQRCodeStats } from "@/features/posters/hooks/useQRCodeStats";
import { QRCodeStatsDisplay } from "@/features/posters/components/QRCode/QRCodeStatsDisplay";

// `recharts` is heavy (~80kb gzipped); lazy-load the chart so it only ships
// when this modal actually opens.
const QRCodeScansChart = lazy(() =>
  import("@/features/posters/components/QRCode/QRCodeScansChart").then((m) => ({
    default: m.QRCodeScansChart,
  })),
);
import type { QRCode } from "@/features/posters/types";
import { generateQRCodeUrl } from "@/shared/utils/qrGenerator";
import { getQRImageUrl } from "@/features/posters/api/posters.api";
import { DrawerBody } from "@/shared/layout";
import { EmptyState } from "@/shared/ui/modal-components";

interface QRCodeDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  qrCode: QRCode;
}

export function QRCodeDetailsModal({ isOpen, onClose, qrCode }: QRCodeDetailsModalProps) {
  const { t } = useTranslation();
  const qrCodeScans = useQRCodeScans({ qrCode, isOpen });
  const qrCodeStats = useQRCodeStats({
    scans: qrCodeScans.scans,
    timeRange: qrCodeScans.timeRange,
  });


  const qrUrl = generateQRCodeUrl(qrCode.id);
  const posterImageSrc = qrCode.imageUrl ? getQRImageUrl(qrCode.imageUrl) : undefined;

  const qrSize = 120;
  const qrPadding = 8;
  const previewSize = qrSize + qrPadding * 2;

  return (
    <Drawer open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
      <DrawerContent aria-describedby={undefined}>
        <DrawerHeader>
          <DrawerTitle>{qrCode.name}</DrawerTitle>
        </DrawerHeader>

        <DrawerBody>
          <div className="space-y-6">
            {/* Poster image + QR preview: same outer size, QR has padding so it isn't cropped */}
            <div className="flex items-start gap-4">
              <div
                className="shrink-0 rounded-lg overflow-hidden border border-border bg-secondary"
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
                    <Megaphone className="size-10" />
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
              <Suspense fallback={<div className="h-48" aria-hidden />}>
                <QRCodeScansChart
                  timeRange={qrCodeScans.timeRange}
                  onTimeRangeChange={qrCodeScans.setTimeRange}
                  totalScansData={qrCodeStats.stats.totalScansData}
                  uniqueScansData={qrCodeStats.stats.uniqueScansData}
                  hideTimeRangeSelector
                />
              </Suspense>
            ) : (
              <EmptyState
                icon={Eye}
                title={t("qrCode.noScanData")}
                description={t("qrCode.noScanDataDesc")}
              />
            )}
          </div>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
