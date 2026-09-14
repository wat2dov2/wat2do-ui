import { useTranslation } from "react-i18next";
import { Megaphone, Link, Users, Building2 } from "@/shared/ui/doodle-icons";
import { AdminCard } from "@/shared/ui/AdminCard";

interface ClubPanelProps {
  onNavigate: (page: "club-panel-posters" | "club-panel-integrations" | "club-panel-members") => void;
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <AdminCard
          icon={Megaphone}
          title={t("clubPanel.posters")}
          description={t("clubPanel.postersDesc")}
          onClick={() => onNavigate("club-panel-posters")}
        />
        <AdminCard
          icon={Link}
          title={t("clubPanel.integrations")}
          description={t("clubPanel.integrationsDesc")}
          onClick={() => onNavigate("club-panel-integrations")}
        />
        <AdminCard
          icon={Users}
          title={t("clubPanel.members")}
          description={t("clubPanel.membersDesc")}
          onClick={() => onNavigate("club-panel-members")}
        />
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-1">{t("clubPanel.recentActivity")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("admin.recentActivityDesc")}
          </p>
        </div>

        <div className="bg-surface border border-border rounded-xl p-8 text-center">
          <p className="text-sm text-muted-foreground">{t("clubPanel.noRecentActivity")}</p>
        </div>
      </div>
    </div>
  );
}
