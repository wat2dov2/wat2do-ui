/**
 * Sidebar Component
 * Refactored to eliminate useState - uses CSS group-hover instead
 * Reduced Tailwind classes via reusable components
 */

import React from "react";
import {
  Search,
  CalendarDays,
  Plus,
  Target,
  Mail,
  Shield,
  Settings,
} from "lucide-react";
import { FolderTabs } from "@/shared/ui/folder-tabs";
import { useSidebar } from "@/app/hooks/useSidebar";
import { useAppContext } from "@/contexts/AppContext";
import { cn } from "@/shared/lib/utils";

export function Sidebar() {
  const {
    pageMode,
    profileCompleted,
  } = useAppContext();

  const {
    handleCommandPaletteClick,
    handleExploreClick,
    handleCreateClick,
    handleClubsClick,
    handleMissionClick,
    handleSettingsClick,
    translations,
  } = useSidebar();

  const mainTabItems = [
    {
      id: "search",
      label: translations.search,
      icon: Search,
      onClick: handleCommandPaletteClick,
    },
    {
      id: "events",
      label: translations.events,
      icon: CalendarDays,
      active: pageMode === "events",
      onClick: handleExploreClick,
    },
    {
      id: "create",
      label: translations.create,
      icon: Plus,
      onClick: handleCreateClick,
    },
    {
      id: "clubs",
      label: translations.clubs,
      icon: Shield,
      active: pageMode === "clubs",
      onClick: handleClubsClick,
    },
    {
      id: "mission",
      label: translations.mission,
      icon: Target,
      active: pageMode === "about",
      onClick: handleMissionClick,
    },
    {
      id: "contact",
      label: translations.contact,
      icon: Mail,
    },
  ];

  const settingsTabItems = [
    {
      id: "settings",
      label: translations.settings,
      icon: Settings,
      active: pageMode === "settings",
      onClick: handleSettingsClick,
    },
  ];

  return (
    <aside
      className={cn(
        "group/sidebar flex flex-col transition-all duration-200 overflow-visible",
        "cork-chrome fixed bottom-0 left-0 top-12 z-40 border-r border-border",
        "w-[72px]"
      )}
    >
      <div className="p-3">
        <nav>
          <FolderTabs items={mainTabItems} />
        </nav>
      </div>

      {/* Settings Section */}
      {profileCompleted && (
        <div className="mt-auto border-t border-border p-3">
          <FolderTabs items={settingsTabItems} />
        </div>
      )}
    </aside>
  );
}
