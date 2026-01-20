import React, { useState, useMemo } from "react";
import { Shield, Calendar, FileText, Megaphone, ArrowRight, Clock, QrCode } from "lucide-react";
import { Button } from "./ui/button";
import { getEventSubmissions, getScrappedEvents, type AdminActivity } from "@/data/adminData";
import { getQRCodes } from "@/utils/qrRedirect";
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
  events: any[];
  onNavigate: (page: "admin-events" | "admin-clubs" | "admin-submissions" | "admin-posters") => void;
}

export function AdminPanel({ events, onNavigate }: AdminPanelProps) {
  // Get recent activities
  const recentActivities = useMemo(() => {
    const submissions = getEventSubmissions()
      .filter((s) => s.status === "pending")
      .map((s) => ({
        type: "submission" as const,
        data: s,
        timestamp: new Date(s.submittedAt),
      }));

    const scrapped = getScrappedEvents().map((s) => ({
      type: "scrapped" as const,
      data: s,
      timestamp: new Date(s.scrappedAt),
    }));

    // Get created posters (QR codes)
    const userEmail = localStorage.getItem("userEmail") || "";
    const allQRCodes = getQRCodes();
    const createdPosters = allQRCodes
      .filter((qr) => qr.createdBy === userEmail)
      .map((qr) => ({
        type: "poster" as const,
        data: qr,
        timestamp: new Date(qr.createdAt),
      }));

    // Combine and sort by timestamp (newest first)
    const all: Array<{
      type: "submission" | "scrapped" | "poster";
      data: any;
      timestamp: Date;
    }> = [...submissions, ...scrapped, ...createdPosters];

    return all
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 10); // Show last 10 activities
  }, []);


  const handleActivityClick = (activity: typeof recentActivities[0]) => {
    if (activity.type === "submission") {
      onNavigate("admin-submissions");
      // URL param will be handled by AdminSubmissionsPage via useSearchParams
      setTimeout(() => {
        const url = new URL(window.location.href);
        url.searchParams.set("submissionId", activity.data.id);
        window.history.pushState({}, "", url.toString());
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, 0);
    } else if (activity.type === "scrapped") {
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
          <h1 className="text-2xl font-bold text-gray-900">Admin Panel</h1>
          <p className="text-sm text-muted-foreground">
            Manage events, clubs, submissions, and marketing
          </p>
        </div>
      </div>

      {/* Navigation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          onClick={() => onNavigate("admin-events")}
          className="bg-muted hover:bg-gray-200 rounded-xl p-6 flex flex-col items-start gap-3 transition-colors text-left border border-border"
        >
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <Calendar className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 mb-1">Events</h3>
            <p className="text-xs text-muted-foreground">
              Manage and edit all events
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
        </button>

        <button
          onClick={() => onNavigate("admin-clubs")}
          className="bg-muted hover:bg-gray-200 rounded-xl p-6 flex flex-col items-start gap-3 transition-colors text-left border border-border"
        >
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 mb-1">Clubs</h3>
            <p className="text-xs text-muted-foreground">
              Manage student clubs
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
        </button>

        <button
          onClick={() => onNavigate("admin-submissions")}
          className="bg-muted hover:bg-gray-200 rounded-xl p-6 flex flex-col items-start gap-3 transition-colors text-left border border-border"
        >
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 mb-1">Submissions</h3>
            <p className="text-xs text-muted-foreground">
              Review event submissions
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
        </button>

        <button
          onClick={() => onNavigate("admin-posters")}
          className="bg-muted hover:bg-gray-200 rounded-xl p-6 flex flex-col items-start gap-3 transition-colors text-left border border-border"
        >
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <Megaphone className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900 mb-1">Posters</h3>
            <p className="text-xs text-muted-foreground">
              Manage QR code posters
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* Recent Activity Feed */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Recent Activity</h2>
          <p className="text-sm text-muted-foreground">
            Recent submissions and scrapped events requiring attention
          </p>
        </div>

        {recentActivities.length > 0 ? (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="divide-y divide-border">
              {recentActivities.map((activity) => (
                <button
                  key={`${activity.type}-${activity.data.id}`}
                  onClick={() => handleActivityClick(activity)}
                  className="w-full p-4 hover:bg-muted/50 transition-colors text-left"
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
                          <p className="text-sm text-gray-900 mb-1">
                            {activity.type === "submission" ? (
                              <>
                                <span className="font-bold">New event submission</span>
                                <span className="font-normal text-gray-600">: {activity.data.eventData.title}</span>
                              </>
                            ) : activity.type === "scrapped" ? (
                              <>
                                <span className="font-semibold">Event scrapped</span>
                                <span className="font-normal text-gray-600">: Event ID {activity.data.eventId}</span>
                              </>
                            ) : (
                              <>
                                <span className="font-bold">Created poster</span>
                                <span className="font-normal text-gray-600">: {activity.data.name}</span>
                              </>
                            )}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            <span>{formatRelativeTime(activity.timestamp)}</span>
                            {activity.type === "submission" && (
                              <>
                                <span>•</span>
                                <span>By {activity.data.submittedBy}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleActivityClick(activity);
                          }}
                        >
                          View
                          <ArrowRight className="w-3 h-3 ml-1" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl p-8 text-center">
            <p className="text-sm text-muted-foreground">No recent activity</p>
          </div>
        )}
      </div>
    </div>
  );
}
