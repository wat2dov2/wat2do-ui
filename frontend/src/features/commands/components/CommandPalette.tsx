import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Tag,
  SlidersHorizontal,
  Grid3x3,
  Calendar,
  Plus,
  X,
  Heart,
  LogIn,
  User,
  Bell,
  Palette,
  Shield,
  HelpCircle,
  Settings,
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
import { useCommandPalette } from "@/features/commands/context/CommandPaletteContext";

interface CommandPaletteProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({
  isOpen,
  onOpenChange,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    profileCompleted,
    viewMode,
    setViewMode,
    setShowFilterDropdown,
    setShowSubmitEvent,
    setShowOnboarding,
    onClearAllFilters,
    onSetFreeFilter,
  } = useCommandPalette();

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
            <Search className="mr-2 h-4 w-4" />
            <span>{t("commands.searchEvents")}</span>
            <CommandShortcut>/</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              onSetFreeFilter();
              onOpenChange(false);
            }}
          >
            <Tag className="mr-2 h-4 w-4" />
            <span>{t("commands.showFreeEvents")}</span>
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
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            <span>{t("commands.openFilters")}</span>
            <CommandShortcut>F</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setViewMode("grid");
              onOpenChange(false);
            }}
          >
            <Grid3x3 className="mr-2 h-4 w-4" />
            <span>{t("commands.gridView")}</span>
            <CommandShortcut>G</CommandShortcut>
          </CommandItem>

          <CommandItem
            onSelect={() => {
              setViewMode("calendar");
              onOpenChange(false);
            }}
          >
            <Calendar className="mr-2 h-4 w-4" />
            <span>{t("commands.calendarView")}</span>
            <CommandShortcut>C</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Actions Section */}
        <CommandGroup heading={t("common.actions")}>
          <CommandItem
            onSelect={() => {
              setShowSubmitEvent(true);
              onOpenChange(false);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            <span>{t("commands.createNewEvent")}</span>
            <CommandShortcut>N</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              onClearAllFilters();
              onOpenChange(false);
            }}
          >
            <X className="mr-2 h-4 w-4" />
            <span>{t("events.clearAllFilters")}</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Personal Section */}
        <CommandGroup heading={t("commands.personal")}>
          {profileCompleted ? (
              <>
              <CommandItem
                onSelect={() => {
                  // Navigate to saved events (placeholder)
                  onOpenChange(false);
                }}
              >
                <Heart className="mr-2 h-4 w-4" />
                <span>{t("commands.savedEvents")}</span>
              </CommandItem>
            </>
          ) : (
            <CommandItem
              onSelect={() => {
                setShowOnboarding(true);
                onOpenChange(false);
              }}
            >
              <LogIn className="mr-2 h-4 w-4" />
              <span>{t("commands.signInToUnlockFeatures")}</span>
            </CommandItem>
          )}
        </CommandGroup>

        <CommandSeparator />

        {/* Personal Settings Section */}
        <CommandGroup heading={t("commands.personalSettings")}>
          <CommandItem
            onSelect={() => {
              navigate("/settings?tab=profile");
              onOpenChange(false);
            }}
          >
            <User className="mr-2 h-4 w-4" />
            <span>
              {profileCompleted ? t("commands.editProfile") : t("commands.createProfile")}
            </span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              navigate("/settings?tab=notifications");
              onOpenChange(false);
            }}
          >
            <Bell className="mr-2 h-4 w-4" />
            <span>{t("commands.notificationPreferences")}</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              navigate("/settings?tab=appearance");
              onOpenChange(false);
            }}
          >
            <Palette className="mr-2 h-4 w-4" />
            <span>{t("commands.themeAppearance")}</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              navigate("/settings?tab=privacy");
              onOpenChange(false);
            }}
          >
            <Shield className="mr-2 h-4 w-4" />
            <span>{t("commands.privacySettings")}</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              navigate("/about");
              onOpenChange(false);
            }}
          >
            <HelpCircle className="mr-2 h-4 w-4" />
            <span>{t("commands.helpSupport")}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
