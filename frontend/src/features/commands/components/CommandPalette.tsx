import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Search,
  SlidersHorizontal,
  Grid3x3,
  Calendar,
  Plus,
  X,
  User,
  Bell,
  Palette,
  Shield,
  HelpCircle,
} from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "@/shared/ui/command";
import { useAppPrefsStore } from "@/shared/store/appPrefs.store";
import { useModalStore } from "@/shared/store/modal.store";
import { settingsTabPath, SETTINGS_TABS, ROUTES } from "@/shared/constants/routes";

interface CommandPaletteProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  setShowFilterDropdown: (show: boolean) => void;
  onClearAllFilters: () => void;
  canSubmitEvents: boolean;
  personalItems: React.ReactNode;
  profileLabel: string;
}

export function CommandPalette({
  isOpen,
  onOpenChange,
  setShowFilterDropdown,
  onClearAllFilters,
  canSubmitEvents,
  personalItems,
  profileLabel,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setViewMode = useAppPrefsStore((s) => s.setViewMode);
  const setShowSubmitEvent = useModalStore((s) => s.setShowSubmitEvent);

  return (
    <CommandDialog open={isOpen} onOpenChange={onOpenChange} title={t("commands.commandPalette")} description={t("commands.commandPaletteDescription")}>
      <CommandInput placeholder={t("commands.typeCommand")} />
      <CommandList>
        <CommandEmpty>{t("events.noResults")}</CommandEmpty>

        {/* Search Section */}
        <CommandGroup heading={t("common.search")}>
          <CommandItem
            onSelect={() => {
              onOpenChange(false);
              // Focus the main search input
              const searchInput = document.querySelector(
                `input[placeholder="${t("search.placeholder")}"]`
              ) as HTMLInputElement;
              searchInput?.focus();
            }}
          >
            <Search className="mr-2 size-4" />
            <span>{t("commands.searchEvents")}</span>
            <CommandShortcut>/</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Commands Section */}
        <CommandGroup heading={t("commands.commands")}>
          <CommandItem
            onSelect={() => {
              setShowFilterDropdown(true);
              onOpenChange(false);
            }}
          >
            <SlidersHorizontal className="mr-2 size-4" />
            <span>{t("commands.openFilters")}</span>
            <CommandShortcut>F</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setViewMode("grid");
              onOpenChange(false);
            }}
          >
            <Grid3x3 className="mr-2 size-4" />
            <span>{t("commands.gridView")}</span>
            <CommandShortcut>G</CommandShortcut>
          </CommandItem>

          <CommandItem
            onSelect={() => {
              setViewMode("calendar");
              onOpenChange(false);
            }}
          >
            <Calendar className="mr-2 size-4" />
            <span>{t("commands.calendarView")}</span>
            <CommandShortcut>C</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Actions Section */}
        <CommandGroup heading={t("common.actions")}>
          {canSubmitEvents && (
            <CommandItem
              onSelect={() => {
                setShowSubmitEvent(true);
                onOpenChange(false);
              }}
            >
              <Plus className="mr-2 size-4" />
              <span>{t("commands.createNewEvent")}</span>
              <CommandShortcut>N</CommandShortcut>
            </CommandItem>
          )}
          <CommandItem
            onSelect={() => {
              onClearAllFilters();
              onOpenChange(false);
            }}
          >
            <X className="mr-2 size-4" />
            <span>{t("events.clearAllFilters")}</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Personal Section */}
        <CommandGroup heading={t("commands.personal")}>
          {personalItems}
        </CommandGroup>

        <CommandSeparator />

        {/* Personal Settings Section */}
        <CommandGroup heading={t("commands.personalSettings")}>
          <CommandItem
            onSelect={() => {
              navigate(settingsTabPath(SETTINGS_TABS.PROFILE));
              onOpenChange(false);
            }}
          >
            <User className="mr-2 size-4" />
            <span>{profileLabel}</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              navigate(settingsTabPath(SETTINGS_TABS.NOTIFICATIONS));
              onOpenChange(false);
            }}
          >
            <Bell className="mr-2 size-4" />
            <span>{t("commands.notificationPreferences")}</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              navigate(settingsTabPath(SETTINGS_TABS.APPEARANCE));
              onOpenChange(false);
            }}
          >
            <Palette className="mr-2 size-4" />
            <span>{t("commands.themeAppearance")}</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              navigate(settingsTabPath(SETTINGS_TABS.PRIVACY));
              onOpenChange(false);
            }}
          >
            <Shield className="mr-2 size-4" />
            <span>{t("commands.privacySettings")}</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              navigate(ROUTES.ABOUT);
              onOpenChange(false);
            }}
          >
            <HelpCircle className="mr-2 size-4" />
            <span>{t("commands.helpSupport")}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
