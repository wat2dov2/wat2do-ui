import React from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Shield, Calendar, FileText, Megaphone, ArrowRight, Clock, QrCode } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { LoadingPage } from "@/shared/ui/loading-page";
import { AdminCard } from "@/features/admin/components/shared/AdminCard";
import { useAdminPanel, type ActivityItem } from "@/features/admin/hooks/useAdminPanel";
import type { Event } from "@/shared/types";
import { formatRelativeTime } from "@/shared/utils/relativeTime";
import { QP } from "@/shared/constants/queryParams";
import { ROUTES } from "@/shared/constants/routes";

interface AdminPanelProps {
  events: Event[];
  onNavigate: (page: "admin-events" | "admin-clubs" | "admin-submissions" | "admin-posters") => void;
}

type ActivityType = ActivityItem["type"];

const activityIconMap: Record<ActivityType, ReactNode> = {
  submission: <FileText className="w-4 h-4 text-primary" />,
  poster: <QrCode className="w-4 h-4 text-primary" />,
  scraped: <Calendar className="w-4 h-4 text-primary" />,
};

/** Extract the display strings from an activity item to avoid deep traversal in JSX. */
function getActivityDisplay(
  activity: ActivityItem,
  events: Event[],
  t: (key: string) => string,
): { label: string; detail: string; submittedBy?: string } {
  if (activity.type === "submission") {
    return {
      label: t("admin.newEventSubmission"),
      detail: activity.data.eventData.title,
      submittedBy: activity.data.submittedBy,
    };
  }
  if (activity.type === "scraped") {
    const event = events.find((e) => e.id === Number(activity.data.eventId));
    const clubName = event?.organization || event?.display_handle || "Unknown";
    const detail = event
      ? `${event.title} (${clubName})`
      : `Event ID ${activity.data.eventId}`;
    return { label: t("admin.eventScraped"), detail };
  }
  // poster
  return { label: "Created poster", detail: activity.data.name };
}

export function AdminPanel({ events, onNavigate }: AdminPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { recentActivities, recentActivityLoading } = useAdminPanel();

  const handleActivityClick = (activity: (typeof recentActivities)[0]) => {
    if (activity.type === "submission") {
      navigate(`${ROUTES.ADMIN_SUBMISSIONS}?${QP.SUBMISSION_ID}=${activity.data.id}`);
    } else if (activity.type === "scraped") {
      navigate(`${ROUTES.ADMIN_EVENTS}?${QP.EVENT_ID}=${activity.data.eventId}`);
    } else if (activity.type === "poster") {
      navigate(`${ROUTES.ADMIN_POSTERS}?${QP.QR_CODE_ID}=${activity.data.id}`);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
          <Shield className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("navigation.adminPanel")}</h1>
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
          icon={FileText}
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
        ) : recentActivities.length > 0 ? (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="divide-y divide-border">
              {recentActivities.map((activity) => (
                <div
                  key={`${activity.type}-${activity.data.id}`}
                  className="w-full p-4 hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => handleActivityClick(activity)}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      {activityIconMap[activity.type]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          {(() => {
                            const { label, detail, submittedBy } = getActivityDisplay(activity, events, t);
                            return (
                              <>
                                <p className="text-sm text-foreground mb-1">
                                  <span className="font-bold">{label}</span>
                                  <span className="font-normal text-muted-foreground">: {detail}</span>
                                </p>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Clock className="w-3 h-3" />
                                  <span>{formatRelativeTime(activity.timestamp)}</span>
                                  {submittedBy && (
                                    <>
                                      <span>•</span>
                                      <span>{t("admin.submittedBy")}: {submittedBy}</span>
                                    </>
                                  )}
                                </div>
                              </>
                            );
                          })()}
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleActivityClick(activity);
                          }}
                        >
                          {t("common.view")}
                          <ArrowRight className="w-3 h-3 ml-1" />
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
