import React, { useCallback } from "react";
import {
  ChevronDown,
  CalendarDays,
  Compass,
  Plus,
} from "lucide-react";
import type { PageMode } from "@/shared/types";
import { useSidebar } from "@/app/hooks/useSidebar";
import { SidebarButton } from "@/shared/ui/sidebar-button";
import { cn } from "@/shared/lib/utils";

interface SidebarEventsSectionProps {
  pageMode: PageMode;
  eventsExpanded: boolean;
  setEventsExpanded: (expanded: boolean) => void;
  profileCompleted: boolean;
  setShowSubmitEvent: (show: boolean) => void;
}

function areEventsSectionPropsEqual(
  prevProps: SidebarEventsSectionProps,
  nextProps: SidebarEventsSectionProps
) {
  return (
    prevProps.pageMode === nextProps.pageMode &&
    prevProps.eventsExpanded === nextProps.eventsExpanded &&
    prevProps.profileCompleted === nextProps.profileCompleted &&
    prevProps.setEventsExpanded === nextProps.setEventsExpanded &&
    prevProps.setShowSubmitEvent === nextProps.setShowSubmitEvent
  );
}

export const SidebarEventsSection = React.memo(function SidebarEventsSection({
  pageMode,
  eventsExpanded,
  setEventsExpanded,
  profileCompleted,
  setShowSubmitEvent,
}: SidebarEventsSectionProps) {
  const handleEventsToggle = useCallback(() => {
    setEventsExpanded(!eventsExpanded);
  }, [eventsExpanded, setEventsExpanded]);

  const {
    handleExploreClick,
    handleCreateClick,
    translations,
  } = useSidebar();

  if (profileCompleted) {
    // Logged In: Expandable Events with sublinks
    return (
      <div
        className={cn(
          "rounded-xl",
          pageMode === "events" && "bg-muted"
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
            className="w-4 h-4 shrink-0"
            strokeWidth={2}
          />
          <span className="flex-1 whitespace-nowrap transition-opacity duration-150 opacity-0 group-hover/sidebar:opacity-100">
            {translations.events}
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
              label={translations.explore}
              isActive={pageMode === "events"}
              onClick={handleExploreClick}
            />
            <SidebarButton
              icon={Plus}
              label={translations.create}
              onClick={handleCreateClick}
            />
          </div>
        </div>
      </div>
    );
  }

  // Logged Out: Simple Events link
  return (
    <SidebarButton
      icon={CalendarDays}
      label={translations.events}
      isActive={pageMode === "events"}
      onClick={handleExploreClick}
    />
  );
}, areEventsSectionPropsEqual);
