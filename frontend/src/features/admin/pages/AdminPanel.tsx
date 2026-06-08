import { useMemo } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Shield, Calendar, FileText, Megaphone, ArrowRight, Clock, QrCode, Users } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
import { LoadingPage } from "@/shared/ui/loading-page";
import { AdminCard } from "@/shared/ui/AdminCard";
import { useAdminPanel, mapActivityDisplay, type ActivityDisplay } from "@/features/admin/hooks/useAdminPanel";
import { formatRelativeTime } from "@/shared/utils/relativeTime";
import { QP } from "@/shared/constants/queryParams";
import { ROUTES } from "@/shared/constants/routes";

interface AdminPanelProps {
  onNavigate: (page: "admin-events" | "admin-clubs" | "admin-submissions" | "admin-posters") => void;
}

type ActivityType = ActivityDisplay["type"];

const activityIconMap: Record<ActivityType, ReactNode> = {
  submission: <FileText className="size-4 text-primary" />,
  poster: <QrCode className="size-4 text-primary" />,
};

/** Navigation route map for activity types. */
const activityRouteMap: Record<ActivityType, string> = {
  submission: ROUTES.ADMIN_SUBMISSIONS,
  poster: ROUTES.ADMIN_POSTERS,
};

const activityQueryParamMap: Record<ActivityType, string> = {
  submission: QP.SUBMISSION_ID,
  poster: QP.QR_CODE_ID,
};

export function AdminPanel({ onNavigate }: AdminPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { recentActivities, recentActivityLoading } = useAdminPanel();

  // Pre-map activity data to display objects so the JSX doesn't traverse nested structures
  const displayActivities = useMemo(
    () => recentActivities.map((activity) => mapActivityDisplay(activity, t)),
    [recentActivities, t]
  );

  const handleActivityClick = (display: ActivityDisplay) => {
    const route = activityRouteMap[display.type];
    const param = activityQueryParamMap[display.type];
    navigate(`${route}?${param}=${display.id}`);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="size-12 rounded-full bg-primary/20 flex items-center justify-center">
          <Shield className="size-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("navigation.adminPanel")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("admin.panelDescription")}
          </p>
        </div>
      </div>

      {/* Navigation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <AdminCard
          icon={Calendar}
          title={t("navigation.events")}
          description={t("admin.manageEventsDesc")}
          onClick={() => onNavigate("admin-events")}
        />
        <AdminCard
          icon={Users}
          title={t("navigation.clubs")}
          description={t("admin.manageClubsDescAlt")}
          onClick={() => onNavigate("admin-clubs")}
        />
        <AdminCard
          icon={FileText}
          title={t("admin.submissions")}
          description={t("admin.reviewSubmissionsDescAlt")}
          onClick={() => onNavigate("admin-submissions")}
        />
        <AdminCard
          icon={Megaphone}
          title={t("admin.posters")}
          description={t("admin.managePostersDescAlt")}
          onClick={() => onNavigate("admin-posters")}
        />
      </div>

      {/* Recent Activity Feed */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-1">{t("admin.recentActivity")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("admin.recentActivityDesc")}
          </p>
        </div>

        {recentActivityLoading ? (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <LoadingPage />
          </div>
        ) : displayActivities.length > 0 ? (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="divide-y divide-border">
              {displayActivities.map((display) => (
                <div
                  key={`${display.type}-${display.id}`}
                  role="button"
                  tabIndex={0}
                  className="w-full p-4 hover:bg-secondary/50 transition-colors cursor-pointer"
                  onClick={() => handleActivityClick(display)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleActivityClick(display);
                    }
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      {activityIconMap[display.type]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground mb-1">
                            <span className="font-bold">{display.label}</span>
                            <span className="font-normal text-muted-foreground">: {display.detail}</span>
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="size-3" />
                            <span>{formatRelativeTime(display.timestamp)}</span>
                            {display.submittedBy && (
                              <>
                                <span>{t("common.separatorBullet")}</span>
                                <span>{t("admin.submittedBy")}: {display.submittedBy}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleActivityClick(display);
                          }}
                        >
                          {t("common.view")}
                          <ArrowRight className="size-3 ml-1" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl p-8 text-center">
            <p className="text-sm text-muted-foreground">{t("admin.noRecentActivity")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
