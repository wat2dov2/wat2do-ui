/**
 * TopNav Component
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Shield, LogOut, Building2 } from "lucide-react";
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
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { useEventsStore } from "@/features/events/store/events.store";
import { ROUTES } from "@/shared/constants/routes";
import { logoutAPI } from "@/features/auth";
import imgImage1 from "@/assets/38e8096a28295e8dcc0e5020d0a5f3dd85d5f019.png";

export function TopNav() {
  const schoolFilter = useEventsStore((s) => s.schoolFilter);
  const setSchoolFilter = useEventsStore((s) => s.setSchoolFilter);
  const { profileCompleted, isAdmin, hasClub } = useAuthState();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleLogoClick = useCallback(() => {
    navigate(ROUTES.HOME);
  }, [navigate]);

  const handleAdminClick = useCallback(() => {
    navigate(ROUTES.ADMIN);
  }, [navigate]);

  const handleClubPanelClick = useCallback(() => {
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
        <SchoolCombobox value={schoolFilter ?? ""} onChange={setSchoolFilter} />
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

        {/* Club Panel Button – only visible to club owners (and admins) */}
        {profileCompleted && (hasClub || isAdmin) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="secondary" size="sm" onClick={handleClubPanelClick}>
                <Building2 className="size-4" strokeWidth={2.5} />
                {t("navigation.clubPanel")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("navigation.clubPanelTooltip")}</p>
            </TooltipContent>
          </Tooltip>
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
