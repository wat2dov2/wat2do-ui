/**
 * Sidebar Component
 * Refactored to eliminate useState - uses CSS group-hover instead
 * Reduced Tailwind classes via reusable components
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Search,
  Shield,
  Target,
  Mail,
  Settings,
} from "lucide-react";
import { SidebarButton } from "@/shared/ui/sidebar-button";
import { SidebarEventsSection } from "@/features/events";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { useModalStore } from "@/shared/store/modal.store";
import { ROUTES } from "@/shared/constants/routes";
import { derivePageMode } from "@/shared/utils/pageMode";
import { cn } from "@/shared/lib/utils";

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const pageMode = derivePageMode(location.pathname);
  const [eventsExpanded, setEventsExpanded] = useState(true);
  const { profileCompleted } = useAuthState();
  const canSubmitEvents = profileCompleted;
  const setShowCommandPalette = useModalStore((s) => s.setShowCommandPalette);
  const setShowSubmitEvent = useModalStore((s) => s.setShowSubmitEvent);

  return (
    <aside
      className={cn(
        "group/sidebar flex flex-col transition-all duration-200 overflow-hidden",
        "fixed left-0 top-12 bottom-0 border-r border-border bg-sidebar z-sidebar",
        "w-12 hover:w-[180px]"
      )}
    >
      <div className="p-2">
        <nav className="flex flex-col gap-1">
          {/* Command Palette Trigger */}
          <SidebarButton
            icon={Search}
            label={t("common.search")}
            onClick={() => setShowCommandPalette(true)}
            badge={
              <div className="flex items-center gap-0.5 opacity-0 group-hover/sidebar:opacity-100 transition-opacity">
                <span className="flex items-center justify-center size-[18px] bg-secondary border border-border rounded shadow-sm text-[9px] text-muted-foreground">
                  ⌘
                </span>
                <span className="flex items-center justify-center size-[18px] bg-secondary border border-border rounded shadow-sm text-[9px] text-muted-foreground">
                  K
                </span>
              </div>
            }
          />

          {/* Events Section */}
          <SidebarEventsSection
            pageMode={pageMode}
            eventsExpanded={eventsExpanded}
            setEventsExpanded={setEventsExpanded}
            profileCompleted={profileCompleted}
            canSubmitEvents={canSubmitEvents}
            setShowSubmitEvent={setShowSubmitEvent}
          />

          <SidebarButton
            icon={Shield}
            label={t("navigation.clubs")}
            isActive={pageMode === "clubs"}
            onClick={() => navigate(ROUTES.CLUBS)}
          />
          <SidebarButton
            icon={Target}
            label={t("navigation.mission")}
            isActive={pageMode === "about"}
            onClick={() => navigate(ROUTES.ABOUT)}
          />
          <SidebarButton
            icon={Mail}
            label={t("navigation.contact")}
          />
        </nav>
      </div>

      {/* Settings Section */}
      {profileCompleted && (
        <div className="mt-auto p-2 border-t border-border">
          <SidebarButton
            icon={Settings}
            label={t("navigation.settings")}
            onClick={() => navigate(ROUTES.SETTINGS)}
          />
        </div>
      )}
    </aside>
  );
}
