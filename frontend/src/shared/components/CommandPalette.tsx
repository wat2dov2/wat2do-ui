import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import {
  Search,
  SlidersHorizontal,
  Grid3x3,
  Calendar,
  Plus,
  X,
  User,
  Bell,
  Heart,
  LogIn,
  Palette,
  HelpCircle,
} from "@/shared/ui/doodle-icons";
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
import { useUIStore } from "@/shared/store/ui.store";
import { toast } from "@/shared/hooks/use-toast";
import { settingsTabPath, SETTINGS_TABS, ROUTES } from "@/shared/constants/routes";
import { focusSearchInput } from "@/shared/utils/searchInput";

interface CommandPaletteProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  setShowFilterDropdown: (show: boolean) => void;
  onClearAllFilters: () => void;
  canSubmitEvents: boolean;
}

export function CommandPalette({
  isOpen,
  onOpenChange,
  setShowFilterDropdown,
  onClearAllFilters,
  canSubmitEvents,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const setViewMode = useUIStore((s) => s.setViewMode);

  return (
    <CommandDialog open={isOpen} onOpenChange={onOpenChange} title={t("commands.commandPalette")} description={t("commands.commandPaletteDescription")}>
      <CommandInput placeholder={t("commands.typeCommand")} />
      <CommandList>
        <CommandEmpty>{t("events.noResults")}</CommandEmpty>

        <CommandGroup heading={t("common.search")}>
          <CommandItem
            onSelect={() => {
              onOpenChange(false);
              focusSearchInput();
            }}
          >
            <Search className="mr-2 size-4" />
            <span>{t("commands.searchEvents")}</span>
            <CommandShortcut>/</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

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

        <CommandGroup heading={t("common.actions")}>
          <CommandItem
            onSelect={() => {
              if (!canSubmitEvents) {
                toast({
                  description: t("navigation.loginRequiredToSubmit"),
                  action: {
                    label: t("events.signIn"),
                    onClick: () => router.push(ROUTES.LOGIN),
                  },
                });
                onOpenChange(false);
                return;
              }
              router.push(ROUTES.EVENT_SUBMIT);
              onOpenChange(false);
            }}
          >
            <Plus className="mr-2 size-4" />
            <span>{t("commands.createNewEvent")}</span>
            <CommandShortcut>N</CommandShortcut>
          </CommandItem>
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

        <CommandGroup heading={t("commands.personal")}>
          {canSubmitEvents ? (
            <CommandItem onSelect={() => onOpenChange(false)}>
              <Heart className="mr-2 size-4" />
              <span>{t("commands.goingEvents")}</span>
            </CommandItem>
          ) : (
            <CommandItem
              onSelect={() => {
                router.push(ROUTES.ONBOARDING);
                onOpenChange(false);
              }}
            >
              <LogIn className="mr-2 size-4" />
              <span>{t("commands.signInToUnlockFeatures")}</span>
            </CommandItem>
          )}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("commands.personalSettings")}>
          <CommandItem
            onSelect={() => {
              router.push(settingsTabPath(SETTINGS_TABS.PROFILE));
              onOpenChange(false);
            }}
          >
            <User className="mr-2 size-4" />
            <span>
              {canSubmitEvents
                ? t("commands.editProfile")
                : t("commands.createProfile")}
            </span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              router.push(settingsTabPath(SETTINGS_TABS.NOTIFICATIONS));
              onOpenChange(false);
            }}
          >
            <Bell className="mr-2 size-4" />
            <span>{t("commands.notificationPreferences")}</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              router.push(settingsTabPath(SETTINGS_TABS.APPEARANCE));
              onOpenChange(false);
            }}
          >
            <Palette className="mr-2 size-4" />
            <span>{t("commands.themeAppearance")}</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              router.push(ROUTES.CONTACT);
              onOpenChange(false);
            }}
          >
            <HelpCircle className="mr-2 size-4" />
            <span>{t("navigation.about")}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
