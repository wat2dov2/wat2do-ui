import React from "react";
import { useTranslation } from "react-i18next";
import { Users, TrendingUp, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import type { QRCode } from "@/shared/types";

interface QRCodeWithStats extends QRCode {
  totalScans: number;
  uniqueScans: number;
  lastScanAt?: string;
}

interface PostersTableProps {
  qrCodes: QRCodeWithStats[];
  onViewDetails: (qrCode: QRCode) => void;
  onDelete: (id: string) => void;
  deleteConfirmId: string | null;
  onDeleteClick: (id: string) => void;
  formatScanTimestamp: (timestamp: string) => string;
}

export function PostersTable({
  qrCodes,
  onViewDetails,
  onDelete,
  deleteConfirmId,
  onDeleteClick,
  formatScanTimestamp,
}: PostersTableProps) {
  const { t } = useTranslation();

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[200px]">{t("qrCode.posterName")}</TableHead>
            <TableHead>{t("admin.totalScans")}</TableHead>
            <TableHead>{t("admin.uniqueScans")}</TableHead>
            <TableHead>{t("admin.lastScan")}</TableHead>
            <TableHead className="text-right">{t("common.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {qrCodes.map((qr) => (
            <TableRow
              key={qr.id}
              id={`poster-${qr.id}`}
              onClick={() => onViewDetails(qr)}
              className="cursor-pointer"
            >
              <TableCell>
                <div className="flex items-center gap-2">
                  {qr.imageUrl ? (
                    <img
                      src={qr.imageUrl}
                      alt={qr.name}
                      className="w-10 h-10 rounded object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded bg-muted shrink-0" />
                  )}
                  <div>
                    <div className="font-medium text-foreground">{qr.name}</div>
                    {qr.description && (
                      <div className="text-xs text-muted-foreground line-clamp-1">
                        {qr.description}
                      </div>
                    )}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="font-medium">{qr.totalScans}</span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="font-medium">{qr.uniqueScans}</span>
                </div>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {qr.lastScanAt ? formatScanTimestamp(qr.lastScanAt) : t("common.never")}
              </TableCell>
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-end gap-2">
                  {deleteConfirmId === qr.id ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => onDelete(qr.id)}
                    >
                      {t("common.confirm")}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDeleteClick(qr.id)}
                      aria-label={t("common.delete")}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
