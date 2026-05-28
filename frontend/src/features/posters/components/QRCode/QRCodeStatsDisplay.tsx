import { useTranslation } from "react-i18next";
import { Eye, Users } from "lucide-react";

interface QRCodeStatsDisplayProps {
  totalScans: number;
  uniqueScans: number;
}

export function QRCodeStatsDisplay({
  totalScans,
  uniqueScans,
}: QRCodeStatsDisplayProps) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="bg-secondary rounded-xl p-4 border border-border">
        <div className="flex items-center gap-2 mb-2">
          <Eye className="size-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{t("admin.totalScans")}</span>
        </div>
        <div className="text-2xl font-bold text-foreground">{totalScans}</div>
      </div>
      <div className="bg-secondary rounded-xl p-4 border border-border">
        <div className="flex items-center gap-2 mb-2">
          <Users className="size-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{t("admin.uniqueScans")}</span>
        </div>
        <div className="text-2xl font-bold text-foreground">{uniqueScans}</div>
      </div>
    </div>
  );
}
