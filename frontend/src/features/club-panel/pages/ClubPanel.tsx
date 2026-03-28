import React from "react";
import { useTranslation } from "react-i18next";
import { Building2, Megaphone, Link, Users } from "lucide-react";
import { AdminCard } from "@/features/admin/components/shared/AdminCard";
import { useBackendPosters } from "@/features/qrcode";
import { LoadingPage } from "@/shared/ui/loading-page";

interface ClubPanelProps {
  onNavigate: (page: "club-panel-posters" | "club-panel-integrations" | "club-panel-members") => void;
}

export function ClubPanel({ onNavigate }: ClubPanelProps) {
  const { t } = useTranslation();
  const { loading: recentActivityLoading } = useBackendPosters();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
          <Building2 className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("clubPanel.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("clubPanel.description")}
          </p>
        </div>
      </div>

      {/* Navigation Cards */}
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

      {/* Recent Activity Feed */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-1">{t("clubPanel.recentActivity")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("admin.recentActivityDesc")}
          </p>
        </div>

        {recentActivityLoading ? (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <LoadingPage />
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl p-8 text-center">
            <p className="text-sm text-muted-foreground">{t("clubPanel.noRecentActivity")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
