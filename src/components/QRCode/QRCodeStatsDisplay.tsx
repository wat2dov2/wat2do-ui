import React from "react";
import { useTranslation } from "react-i18next";
import { Eye, Users, CheckCircle, TrendingUp } from "lucide-react";

interface QRCodeStatsDisplayProps {
  totalScans: number;
  uniqueScans: number;
  conversions: number;
  conversionRate: string;
}

export function QRCodeStatsDisplay({
  totalScans,
  uniqueScans,
  conversions,
  conversionRate,
}: QRCodeStatsDisplayProps) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-muted rounded-xl p-4 border border-border">
        <div className="flex items-center gap-2 mb-2">
          <Eye className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{t("admin.totalScans")}</span>
        </div>
        <div className="text-2xl font-bold text-foreground">
          {totalScans}
        </div>
      </div>
      <div className="bg-muted rounded-xl p-4 border border-border">
        <div className="flex items-center gap-2 mb-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{t("admin.uniqueScans")}</span>
        </div>
        <div className="text-2xl font-bold text-foreground">
          {uniqueScans}
        </div>
      </div>
      <div className="bg-muted rounded-xl p-4 border border-border">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{t("admin.conversions")}</span>
        </div>
        <div className="text-2xl font-bold text-foreground">
          {conversions}
        </div>
      </div>
      <div className="bg-muted rounded-xl p-4 border border-border">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{t("admin.conversionRate")}</span>
        </div>
        <div className="text-2xl font-bold text-foreground">
          {conversionRate}%
        </div>
      </div>
    </div>
  );
}
