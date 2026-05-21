import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown,
  CalendarDays,
  Compass,
  Plus,
} from "lucide-react";
import type { PageMode } from "@/shared/types";
import { SidebarButton } from "@/shared/ui/sidebar-button";
import { ROUTES } from "@/shared/constants/routes";
import { cn } from "@/shared/lib/utils";

interface SidebarEventsSectionProps {
  pageMode: PageMode;
  eventsExpanded: boolean;
  setEventsExpanded: (expanded: boolean) => void;
  profileCompleted: boolean;
  canCreateEvents: boolean;
  setShowSubmitEvent: (show: boolean) => void;
}

export function SidebarEventsSection({
  pageMode,
  eventsExpanded,
  setEventsExpanded,
  profileCompleted,
  canCreateEvents,
  setShowSubmitEvent,
}: SidebarEventsSectionProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleEventsToggle = useCallback(() => {
    setEventsExpanded(!eventsExpanded);
  }, [eventsExpanded, setEventsExpanded]);

  const handleExploreClick = useCallback(() => {
    navigate(ROUTES.HOME);
  }, [navigate]);

  const handleCreateClick = useCallback(() => {
    setShowSubmitEvent(true);
  }, [setShowSubmitEvent]);

  if (profileCompleted) {
    // Logged In: Expandable Events with sublinks
    return (
      <div
        className={cn(
          "rounded-xl",
          pageMode === "events" && "bg-secondary"
        )}
      >
        <button
          onClick={handleEventsToggle}
          className={cn(
            "w-full font-medium text-[11px] rounded-xl text-left",
            "flex items-center px-2 py-1.5 gap-2",
            "transition-colors",
            pageMode === "events"
              ? "text-foreground"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          )}
        >
          <CalendarDays
            className="size-4 shrink-0"
            strokeWidth={2}
          />
          <span className="flex-1 whitespace-nowrap transition-opacity duration-150 opacity-0 group-hover/sidebar:opacity-100">
            {t("navigation.events")}
          </span>
          <ChevronDown
            className={cn(
              "w-3 h-3 shrink-0 transition-transform duration-200",
              "opacity-0 group-hover/sidebar:opacity-100",
              !eventsExpanded && "-rotate-90"
            )}
            strokeWidth={2}
          />
        </button>

        {/* Sublinks */}
        <div
          className={cn(
            "overflow-hidden transition-all duration-200",
            eventsExpanded ? "max-h-[120px] opacity-100" : "max-h-0 opacity-0"
          )}
        >
          <div className={cn(
            "flex flex-col gap-0.5 mt-0.5 transition-[padding-left]",
            "pl-0 group-hover/sidebar:pl-5"
          )}>
            <SidebarButton
              icon={Compass}
              label={t("navigation.explore")}
              isActive={pageMode === "events"}
              onClick={handleExploreClick}
            />
            {canCreateEvents && (
              <SidebarButton
                icon={Plus}
                label={t("navigation.create")}
                onClick={handleCreateClick}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  // Logged Out: Simple Events link
  return (
    <SidebarButton
      icon={CalendarDays}
      label={t("navigation.events")}
      isActive={pageMode === "events"}
      onClick={handleExploreClick}
    />
  );
}
