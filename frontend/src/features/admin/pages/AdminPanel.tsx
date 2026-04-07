import React, { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Shield, Calendar, FileText, Megaphone, ArrowRight, Clock, QrCode } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { LoadingPage } from "@/shared/ui/loading-page";
import { getEventSubmissions, getScrapedEvents } from "@/features/admin/api/admin.api";
import { getSession } from "@/features/auth/api/auth.api";
import { useBackendPosters } from "@/features/qrcode";
import { AdminCard } from "@/features/admin/components/shared/AdminCard";
import type { Event } from "@/shared/types";
import type { EventSubmission, ScrapedEvent } from "@/shared/types";
import type { QRCode } from "@/shared/types";
// Format relative time helper
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  return date.toLocaleDateString();
}

interface AdminPanelProps {
  events: Event[];
  onNavigate: (page: "admin-events" | "admin-clubs" | "admin-submissions" | "admin-posters") => void;
}

export function AdminPanel({ events, onNavigate }: AdminPanelProps) {
  const { t } = useTranslation();
  const { posters: backendPosters, loading: postersLoading } = useBackendPosters();
  const [submissions, setSubmissions] = useState<EventSubmission[]>([]);
  const [scrapedEvents, setScrapedEvents] = useState<ScrapedEvent[]>([]);
  const [adminDataLoading, setAdminDataLoading] = useState(true);

  // Fetch submissions and scraped events from backend
  useEffect(() => {
    Promise.all([getEventSubmissions(), getScrapedEvents()])
      .then(([subs, scraped]) => {
        setSubmissions(subs);
        setScrapedEvents(scraped);
      })
      .catch((err) => console.error("Failed to load admin data:", err))
      .finally(() => setAdminDataLoading(false));
  }, []);

  const recentActivityLoading = postersLoading || adminDataLoading;

  // Get recent activities
  const recentActivities = useMemo(() => {
    const submissionItems = submissions
      .filter((s) => s.status === "pending")
      .map((s) => ({
        type: "submission" as const,
        data: s,
        timestamp: new Date(s.submittedAt),
      }));

    const scrapedItems = scrapedEvents.map((s) => ({
      type: "scraped" as const,
      data: s,
      timestamp: new Date(s.scrapedAt),
    }));

    const session = getSession();
    const userEmail = session.email || "";
    const createdPosters = backendPosters
      .filter((qr) => qr.createdBy === userEmail)
      .map((qr) => ({
        type: "poster" as const,
        data: qr,
        timestamp: new Date(qr.createdAt),
      }));

    type ActivityItem =
      | { type: "submission"; data: EventSubmission; timestamp: Date }
      | { type: "scraped"; data: ScrapedEvent; timestamp: Date }
      | { type: "poster"; data: QRCode; timestamp: Date };
    const all: ActivityItem[] = [...submissionItems, ...scrapedItems, ...createdPosters];

    return all
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 10);
  }, [submissions, scrapedEvents, backendPosters]);


  const handleActivityClick = (activity: (typeof recentActivities)[0]) => {
    if (activity.type === "submission") {
      onNavigate("admin-submissions");
      // URL param will be handled by AdminSubmissionsPage via useSearchParams
      setTimeout(() => {
        const url = new URL(window.location.href);
        url.searchParams.set("submissionId", activity.data.id);
        window.history.pushState({}, "", url.toString());
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, 0);
    } else if (activity.type === "scraped") {
      onNavigate("admin-events");
      // URL param will be handled by AdminEventsPage via useSearchParams
      setTimeout(() => {
        const url = new URL(window.location.href);
        url.searchParams.set("eventId", activity.data.eventId.toString());
        window.history.pushState({}, "", url.toString());
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, 0);
    } else if (activity.type === "poster") {
      onNavigate("admin-posters");
      // URL param will be handled by AdminPostersPage via useSearchParams
      setTimeout(() => {
        const url = new URL(window.location.href);
        url.searchParams.set("qrCodeId", activity.data.id);
        window.history.pushState({}, "", url.toString());
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, 0);
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
                      {activity.type === "submission" ? (
                        <FileText className="w-4 h-4 text-primary" />
                      ) : activity.type === "poster" ? (
                        <QrCode className="w-4 h-4 text-primary" />
                      ) : (
                        <Calendar className="w-4 h-4 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground mb-1">
                            {activity.type === "submission" ? (
                              <>
                                <span className="font-bold">{t("admin.newEventSubmission")}</span>
                                <span className="font-normal text-muted-foreground">: {activity.data.eventData.title}</span>
                              </>
                            ) : activity.type === "scraped" ? (
                              (() => {
                                const event = events.find((e) => e.id === Number(activity.data.eventId));
                                const clubName = event?.organization || event?.display_handle || 'Unknown';
                                return (
                                  <>
                                    <span className="font-semibold">{t("admin.eventScraped")}</span>
                                    <span className="font-normal text-muted-foreground">
                                      : {event ? `${event.title} (${clubName})` : `Event ID ${activity.data.eventId}`}
                                    </span>
                                  </>
                                );
                              })()
                            ) : (
                              <>
                                <span className="font-bold">Created poster</span>
                                <span className="font-normal text-muted-foreground">: {activity.data.name}</span>
                              </>
                            )}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            <span>{formatRelativeTime(activity.timestamp)}</span>
                            {activity.type === "submission" && (
                              <>
                                <span>•</span>
                                <span>{t("admin.submittedBy")}: {activity.data.submittedBy}</span>
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
