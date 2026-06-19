import { useTranslation } from "react-i18next";
import { Megaphone, Link, Users, Building2 } from "@/shared/ui/doodle-icons";
import { AdminCard } from "@/shared/ui/AdminCard";
import { useBackendPosters } from "@/features/posters";
import { LoadingPage } from "@/shared/ui/loading-page";

interface OrganizationPanelProps {
  onNavigate: (page: "organization-panel-posters" | "organization-panel-integrations" | "organization-panel-members") => void;
}

export function OrganizationPanel({ onNavigate }: OrganizationPanelProps) {
  const { t } = useTranslation();
  const { loading: recentActivityLoading } = useBackendPosters();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="size-12 rounded-full bg-primary/20 flex items-center justify-center">
          <Building2 className="size-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("organizationPanel.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("organizationPanel.description")}
          </p>
        </div>
      </div>

      {/* Navigation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <AdminCard
          icon={Megaphone}
          title={t("organizationPanel.posters")}
          description={t("organizationPanel.postersDesc")}
          onMouseDown={() => onNavigate("organization-panel-posters")}
        />
        <AdminCard
          icon={Link}
          title={t("organizationPanel.integrations")}
          description={t("organizationPanel.integrationsDesc")}
          onMouseDown={() => onNavigate("organization-panel-integrations")}
        />
        <AdminCard
          icon={Users}
          title={t("organizationPanel.members")}
          description={t("organizationPanel.membersDesc")}
          onMouseDown={() => onNavigate("organization-panel-members")}
        />
      </div>

      {/* Recent Activity Feed */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-1">{t("organizationPanel.recentActivity")}</h2>
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
            <p className="text-sm text-muted-foreground">{t("organizationPanel.noRecentActivity")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
