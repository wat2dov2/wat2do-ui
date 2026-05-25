/**
 * TopNav Component
 */

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useLocation } from "react-router-dom";
import { Check, ChevronsUpDown, LogOut, Search, Shield } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/shared/ui/tooltip";
import { Button } from "@/shared/ui/button";
import { SchoolCombobox } from "@/shared/ui/school-combobox";
import { AnimatedThemeToggler } from "@/shared/components/AnimatedThemeToggler";
import { LanguageSelector } from "@/shared/ui/language-selector";
import { InteractiveHoverButton } from "@/shared/ui/interactive-hover-button";
import { Highlighter } from "@/shared/ui/highlighter";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import {
  getUserProfile,
  logoutAPI,
  updateUserProfile,
  useAuthState,
  type AuthState,
} from "@/features/auth";
import { useEventsStore } from "@/features/events";
import { ROUTES } from "@/shared/constants/routes";
import { cn } from "@/shared/lib/utils";
import imgImage1 from "@/assets/38e8096a28295e8dcc0e5020d0a5f3dd85d5f019.png";

type NavClub = AuthState["clubs"][number];

export function TopNav() {
  const schoolFilter = useEventsStore((s) => s.schoolFilter);
  const setSchoolFilter = useEventsStore((s) => s.setSchoolFilter);
  const { profileCompleted, isAdmin, clubs, clubId } = useAuthState();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [clubMenuOpen, setClubMenuOpen] = useState(false);
  const [clubSearch, setClubSearch] = useState("");
  const activeClub = clubs.find((club) => club.id === clubId) ?? clubs[0];
  const canOpenClubPanel = profileCompleted && Boolean(activeClub);

  const filteredClubs = clubs.filter((club) => {
    const clubSchool = club.school || "University of Waterloo";
    const matchesSchool = !schoolFilter || clubSchool === schoolFilter;
    const matchesSearch = club.club_name.toLowerCase().includes(clubSearch.toLowerCase());
    return matchesSchool && matchesSearch;
  });

  const handleSchoolChange = useCallback((newSchool: string) => {
    setSchoolFilter(newSchool);
    if (pathname === ROUTES.CLUB_PANEL || pathname.startsWith(`${ROUTES.CLUB_PANEL}/`)) {
      navigate(ROUTES.HOME);
    }
  }, [setSchoolFilter, pathname, navigate]);

  const handleLogoClick = useCallback(() => {
    navigate(ROUTES.HOME);
  }, [navigate]);

  const handleAdminClick = useCallback(() => {
    navigate(ROUTES.ADMIN);
  }, [navigate]);

  const handleClubSelect = useCallback((club: NavClub) => {
    const profile = getUserProfile();
    if (profile) {
      updateUserProfile({
        ...profile,
        clubId: club.id,
        clubName: club.club_name,
      });
    }
    navigate(ROUTES.CLUB_PANEL);
  }, [navigate]);

  const handleSignOut = useCallback(async () => {
    try {
      await logoutAPI();
    } catch (err) {
      console.error("Logout API call failed, clearing local state anyway:", err);
    }
    // logoutAPI → clearAllAuthData fires AUTH_STATE_REFRESH_EVENT which the
    // useAuthState snapshot subscribes to — the UI flips back to signed-out
    // automatically. No manual setters needed.
  }, []);

  const handleSignIn = useCallback(() => {
    navigate(ROUTES.LOGIN);
  }, [navigate]);

  return (
    <header className="flex items-center justify-between fixed top-0 left-0 right-0 h-12 pl-5 pr-5 border-b border-border bg-sidebar z-nav">
      <div className="flex items-center gap-2.5">
        <button
          onClick={handleLogoClick}
          className="size-6 shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
          aria-label={t("navigation.goToEvents")}
        >
          <img
            alt={t("common.logo")}
            className="w-full h-full object-cover rounded"
            src={imgImage1}
          />
        </button>
        <span className="text-muted-foreground text-lg font-light">/</span>
        <SchoolCombobox value={schoolFilter ?? ""} onChange={handleSchoolChange} />
      </div>

      <div className="flex items-center gap-2">
        {/* Admin Button – only visible to admins */}
        {profileCompleted && isAdmin && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="secondary" size="sm" onClick={handleAdminClick}>
                <Shield className="size-4" strokeWidth={2.5} />
                {t("navigation.admin")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("navigation.adminPanel")}</p>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Club switcher – only visible when the user has associated clubs */}
        {canOpenClubPanel && (
          <Popover open={clubMenuOpen} onOpenChange={setClubMenuOpen}>
            <PopoverTrigger asChild>
              <button
                className="flex text-white items-center gap-1 px-3 h-8 max-w-[240px] bg-transparent hover:bg-secondary rounded-xl transition-colors"
                aria-expanded={clubMenuOpen}
                type="button"
              >
                <span className="truncate">
                  <Highlighter action="highlight" color="var(--primary)">
                    {activeClub.club_name}
                  </Highlighter>
                </span>
                <ChevronsUpDown className="size-3.5 text-muted-foreground shrink-0" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[280px] p-0 bg-popover border-border"
              align="end"
              aria-label={t("navigation.clubPanelTooltip")}
            >
              <div className="flex items-center border-b border-border px-3">
                <Search className="size-4 text-muted-foreground shrink-0" />
                <input
                  type="text"
                  placeholder={t("clubs.searchPlaceholder")}
                  value={clubSearch}
                  onChange={(e) => setClubSearch(e.target.value)}
                  className="flex-1 px-2 py-2.5 text-sm bg-transparent focus:outline-none text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="max-h-[200px] overflow-y-auto p-1">
                {filteredClubs.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    {t("clubs.noClubsFound")}
                  </div>
                ) : (
                  filteredClubs.map((club) => (
                    <button
                      key={club.id}
                      onClick={() => {
                        handleClubSelect(club);
                        setClubMenuOpen(false);
                        setClubSearch("");
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-2 text-sm rounded-xl text-left transition-colors",
                        activeClub.id === club.id
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-secondary text-foreground"
                      )}
                      type="button"
                    >
                      <Check
                        className={cn(
                          "w-4 h-4 shrink-0",
                          activeClub.id === club.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="truncate">{club.club_name}</span>
                    </button>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}

        {/* Language Selector */}
        <LanguageSelector />

        {/* Dark Mode Toggle */}
        <AnimatedThemeToggler />

        {/* Auth Button */}
        {profileCompleted ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="secondary" size="sm" onClick={handleSignOut}>
                <LogOut className="size-4" strokeWidth={2.5} />
                {t("modals.signOut.logOut")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("modals.signOut.signOutOfAccount")}</p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <InteractiveHoverButton
                onClick={handleSignIn}
                className="flex items-center gap-1.5 bg-primary border-primary text-primary-foreground text-sm px-6 py-1.5 min-w-[120px] justify-center"
                hideDot
              >
                {t("events.signIn")}
              </InteractiveHoverButton>
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
