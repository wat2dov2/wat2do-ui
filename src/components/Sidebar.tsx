/**
 * Sidebar Component
 * Refactored to eliminate useState - uses CSS group-hover instead
 * Reduced Tailwind classes via reusable components
 */

import React from "react";
import {
  Search,
  Shield,
  Target,
  Mail,
  Settings,
} from "lucide-react";
import { SidebarButton } from "@/shared/ui/sidebar-button";
import { SidebarEventsSection } from "@/features/events/components/SidebarEventsSection";
import { useSidebar } from "@/hooks/useSidebar";
import { useAppContext } from "@/contexts/AppContext";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const {
    pageMode,
    eventsExpanded,
    setEventsExpanded,
    profileCompleted,
    setShowCommandPalette,
    setShowSubmitEvent,
  } = useAppContext();

  const {
    handleCommandPaletteClick,
    handleClubsClick,
    handleMissionClick,
    handleSettingsClick,
    translations,
  } = useSidebar();

  return (
    <aside
      className={cn(
        "group/sidebar flex flex-col transition-all duration-200 overflow-hidden",
        "fixed left-0 top-12 bottom-0 border-r border-border bg-sidebar z-40",
        "w-12 hover:w-[180px]"
      )}
    >
      <div className="p-2">
        <nav className="flex flex-col gap-1">
          {/* Command Palette Trigger */}
          <SidebarButton
            icon={Search}
            label={translations.search}
            onClick={handleCommandPaletteClick}
            badge={
              <div className="flex items-center gap-0.5 opacity-0 group-hover/sidebar:opacity-100 transition-opacity">
                <span className="flex items-center justify-center w-[18px] h-[18px] bg-muted border border-border rounded shadow-sm text-[9px] text-muted-foreground">
                  ⌘
                </span>
                <span className="flex items-center justify-center w-[18px] h-[18px] bg-muted border border-border rounded shadow-sm text-[9px] text-muted-foreground">
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
            setShowSubmitEvent={setShowSubmitEvent}
          />

          <SidebarButton
            icon={Shield}
            label={translations.clubs}
            isActive={pageMode === "clubs"}
            onClick={handleClubsClick}
          />
          <SidebarButton
            icon={Target}
            label={translations.mission}
            isActive={pageMode === "about"}
            onClick={handleMissionClick}
          />
          <SidebarButton
            icon={Mail}
            label={translations.contact}
          />
        </nav>
      </div>

      {/* Settings Section */}
      {profileCompleted && (
        <div className="mt-auto p-2 border-t border-border">
          <SidebarButton
            icon={Settings}
            label={translations.settings}
            onClick={handleSettingsClick}
          />
        </div>
      )}
    </aside>
  );
}
