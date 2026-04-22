import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Megaphone,
  Plus,
  Eye,
  QrCode,
  Users,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import type { QRCode } from "@/shared/types";
import {
  CreateQRCodeModal,
  QRCodeDetailsModal,
} from "@/features/qrcode";
import type { Event } from "@/shared/types";
import { Spinner } from "@/shared/ui/spinner";
import { useMarketingData } from "@/features/marketing/hooks/useMarketingData";

interface MarketingPageProps {
  events: Event[];
  userEmail: string;
}

export function MarketingPage({ events, userEmail }: MarketingPageProps) {
  const { t } = useTranslation();
  const { qrCodesWithStats, loading, loadQRCodes, deletePoster } = useMarketingData();

  // Explicit data load on mount (side effect is visible at the call site)
  useEffect(() => {
    loadQRCodes().catch((err) => console.error("Failed to initialize QR codes:", err));
  }, [loadQRCodes]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedQRCode, setSelectedQRCode] = useState<QRCode | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleCreate = () => {
    loadQRCodes();
    setShowCreateModal(false);
  };

  const handleDelete = async (id: string) => {
    try {
      await deletePoster(id);
      setDeleteConfirmId(null);
    } catch (err) {
      console.error("Failed to delete poster:", err);
      // keep dialog open on error
    }
  };

  const handleViewDetails = (qrCode: QRCode) => {
    setSelectedQRCode(qrCode);
    setShowDetailsModal(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Spinner className="w-8 h-8 text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
            <Megaphone className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t("marketing.title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("marketing.description")}
            </p>
          </div>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="w-4 h-4 mr-2" />
          {t("marketing.createQRCode")}
        </Button>
      </div>

      {/* QR Codes Grid */}
      {qrCodesWithStats.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {qrCodesWithStats.map((qr) => (
            <div
              key={qr.id}
              onClick={() => handleViewDetails(qr)}
              className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-md hover:opacity-80 transition-all cursor-pointer"
            >
              {/* Poster Image - Always show (hardcoded for now) */}
              <div className="w-full h-64 bg-linear-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                {qr.imageUrl ? (
                  <img
                    src={qr.imageUrl}
                    alt={qr.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-center p-8">
                    <Megaphone className="w-16 h-16 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">{t("qrCode.posterPreview")}</p>
                  </div>
                )}
              </div>
              
              <div className="p-5">
                <div className="mb-4">
                  <h3 className="font-semibold text-foreground mb-1">{qr.name}</h3>
                  {qr.description && (
                    <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                      {qr.description}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        qr.isActive
                          ? "bg-success/20 text-success"
                          : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {qr.isActive ? t("common.active") : t("common.inactive")}
                    </span>
                  </div>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Eye className="w-4 h-4" />
                    <span className="font-medium">{qr.totalScans}</span>
                    <span className="text-xs">{t("marketing.scans")}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Users className="w-4 h-4" />
                    <span className="font-medium">{qr.uniqueScans}</span>
                    <span className="text-xs">{t("marketing.unique")}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 px-4">
          <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-4">
            <QrCode className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {t("marketing.noQRCodesYet")}
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-md mb-6">
            {t("marketing.noQRCodesDesc")}
          </p>
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            {t("marketing.createQRCode")}
          </Button>
        </div>
      )}

      {/* Create Modal */}
      <CreateQRCodeModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreate}
        events={events}
        userEmail={userEmail}
      />

      {/* Details Modal */}
      {selectedQRCode && (
        <QRCodeDetailsModal
          isOpen={showDetailsModal}
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedQRCode(null);
          }}
          qrCode={selectedQRCode}
          events={events}
        />
      )}

      {/* Delete Confirmation */}
      <Dialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => !open && setDeleteConfirmId(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("marketing.deleteQRCode")}</DialogTitle>
            <DialogDescription>
              {t("marketing.deleteQRCodeConfirm")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end mt-4">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmId(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
            >
              {t("common.delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
