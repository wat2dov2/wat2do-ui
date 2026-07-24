import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Check, ChevronsUpDown, LogOut, Search, Shield } from "@/shared/ui/doodle-icons";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/shared/ui/tooltip";
import { Button } from "@/shared/ui/button";
import { SchoolCombobox } from "@/shared/ui/school-combobox";
import { AnimatedThemeToggler } from "@/shared/components/AnimatedThemeToggler";
import { LanguageSelector } from "@/shared/ui/language-selector";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { useAuthState, type AuthState } from "@/features/auth/hooks/useAuthState";
import { getUserProfile, logoutAPI, updateUserProfile } from "@/features/auth/api/auth.api";
import { useEventsStore } from "@/features/events/store/events.store";
import { ROUTES } from "@/shared/constants/routes";
import { getSchoolOrigin } from "@/shared/constants/schools";
import { cn } from "@/shared/lib/utils";
import imgImage1 from "@/assets/38e8096a28295e8dcc0e5020d0a5f3dd85d5f019.png";

type NavOrganization = AuthState["clubs"][number];

export function TopNav() {
  const schoolFilter = useEventsStore((s) => s.schoolFilter);
  const setSchoolFilter = useEventsStore((s) => s.setSchoolFilter);
  const { profileCompleted, isAdmin, clubs, organizationId } = useAuthState();
  const { t } = useTranslation();
  const router = useRouter();
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [orgSearch, setOrgSearch] = useState("");
  const activeOrganization = clubs.find((club) => club.id === organizationId) ?? clubs[0];
  const canOpenOrganizationPanel = profileCompleted && Boolean(activeOrganization);
  const filteredOrganizations = clubs.filter((club) =>
    club.organization_name.toLowerCase().includes(orgSearch.toLowerCase())
  );

  const handleLogoClick = useCallback(() => {
    router.push(ROUTES.HOME);
  }, [router]);

  const handleAdminClick = useCallback(() => {
    router.push(ROUTES.ADMIN);
  }, [router]);

  const handleOrganizationSelect = useCallback((org: NavOrganization) => {
    const profile = getUserProfile();
    if (profile) {
      updateUserProfile({
        ...profile,
        organizationId: org.id,
        organizationName: org.organization_name,
      });
    }
    router.push(ROUTES.ORGANIZATION_PANEL);
  }, [router]);

  const handleSignOut = useCallback(async () => {
    try {
      await logoutAPI();
    } catch (err) {
      console.error("Logout API call failed, clearing local state anyway:", err);
    }
    // logoutAPI → clearAllAuthData fires AUTH_STATE_REFRESH_EVENT; useAuthState flips UI to signed-out.
  }, []);

  const handleSignIn = useCallback(() => {
    router.push(ROUTES.LOGIN);
  }, [router]);

  const handleSchoolChange = useCallback(
    (school: string) => {
      if (school === "all") {
        setSchoolFilter(school);
        return;
      }
      // Each school lives on its own origin, so switching is a cross-origin navigation.
      window.location.assign(getSchoolOrigin(school));
    },
    [setSchoolFilter],
  );

  return (
    <header className="fixed top-0 left-0 right-0 z-nav flex h-12 items-center justify-between gap-1.5 border-b border-border bg-surface px-2 sm:gap-2 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2.5">
        <button
          onMouseDown={handleLogoClick}
          className="flex h-8 w-10 shrink-0 cursor-pointer items-center justify-center transition-opacity hover:opacity-80"
          aria-label={t("navigation.goToEvents")}
        >
          <img
            alt={t("common.logo")}
            className="h-6 w-[34px] object-contain"
            src={imgImage1.src}
          />
        </button>
        <span className="hidden text-muted-foreground text-lg font-light sm:inline">/</span>
        <SchoolCombobox
          value={schoolFilter ?? ""}
          onChange={handleSchoolChange}
          isAdmin={isAdmin}
          triggerClassName="pl-1 pr-2 sm:pl-1.5 sm:pr-3"
        />
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {profileCompleted && isAdmin && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                onMouseDown={handleAdminClick}
                className="size-8 px-0 sm:w-auto sm:px-3"
              >
                <Shield className="size-4" strokeWidth={2.5} />
                <span className="hidden sm:inline">{t("navigation.admin")}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("navigation.adminPanel")}</p>
            </TooltipContent>
          </Tooltip>
        )}

        {canOpenOrganizationPanel && (
          <Popover open={orgMenuOpen} onOpenChange={setOrgMenuOpen}>
            <PopoverTrigger asChild>
              <button
                className="flex h-8 max-w-[24vw] items-center gap-1 overflow-hidden rounded-xl bg-transparent px-2 text-sm text-foreground transition-colors hover:bg-secondary-hover sm:max-w-[180px] sm:px-3 md:max-w-[240px]"
                aria-expanded={orgMenuOpen}
                type="button"
              >
                <span className="truncate">{activeOrganization.organization_name}</span>
                <ChevronsUpDown className="size-3.5 text-muted-foreground shrink-0" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[280px] p-0 bg-surface-elevated border-border"
              align="end"
              aria-label={t("navigation.clubPanelTooltip")}
            >
              <div className="flex items-center border-b border-border px-3">
                <Search className="size-4 text-muted-foreground shrink-0" />
                <input
                  type="text"
                  placeholder={t("organizations.searchPlaceholder")}
                  value={orgSearch}
                  onChange={(e) => setOrgSearch(e.target.value)}
                  className="flex-1 px-2 py-2.5 text-sm bg-transparent focus:outline-none text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="max-h-[200px] overflow-y-auto p-1">
                {filteredOrganizations.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    {t("organizations.noClubsFound")}
                  </div>
                ) : (
                  filteredOrganizations.map((org) => (
                    <button
                      key={org.id}
                      onMouseDown={() => {
                        handleOrganizationSelect(org);
                        setOrgMenuOpen(false);
                        setOrgSearch("");
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-2 text-sm rounded-xl text-left transition-colors",
                        activeOrganization.id === org.id
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-secondary-hover text-foreground"
                      )}
                      type="button"
                    >
                      <Check
                        className={cn(
                          "w-4 h-4 shrink-0",
                          activeOrganization.id === org.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="truncate">{org.organization_name}</span>
                    </button>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}

        <LanguageSelector />

        <AnimatedThemeToggler />

        {profileCompleted ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="secondary" size="sm" onMouseDown={handleSignOut} className="size-8 px-0 sm:w-auto sm:px-3">
                <LogOut className="size-4" strokeWidth={2.5} />
                <span className="hidden sm:inline">{t("modals.signOut.logOut")}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("modals.signOut.signOutOfAccount")}</p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" onMouseDown={handleSignIn}>
                {t("events.signIn")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("modals.signIn.signInToSavePreferences")}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </header>
  );
}
