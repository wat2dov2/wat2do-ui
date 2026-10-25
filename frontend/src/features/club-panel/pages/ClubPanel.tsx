import { useTranslation } from "react-i18next";
import { Users, Building2 } from "lucide-react";
import { AdminCard } from "@/shared/ui/AdminCard";

interface ClubPanelProps {
  onNavigate: (page: "club-panel-members") => void;
}

export function ClubPanel({ onNavigate }: ClubPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="size-12 rounded-full bg-primary/20 flex items-center justify-center">
          <Building2 className="size-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("clubPanel.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("clubPanel.description")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AdminCard
          icon={Users}
          title={t("clubPanel.members")}
          description={t("clubPanel.membersDesc")}
          onClick={() => onNavigate("club-panel-members")}
        />
      </div>
    </div>
  );
}
