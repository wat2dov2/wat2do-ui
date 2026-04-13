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
import { useUIContext } from "@/contexts/UIContext";
import { useUserContext } from "@/contexts/UserContext";
import { useModalContext } from "@/contexts/ModalContext";
import { ROUTES } from "@/shared/constants/routes";
import { useAuth } from "@/features/auth";
import imgImage1 from "@/assets/38e8096a28295e8dcc0e5020d0a5f3dd85d5f019.png";

export function TopNav() {
  const { selectedSchool, setSelectedSchool } = useUIContext();
  const { profileCompleted, setProfileCompleted, setUserEmail, isAdmin, hasClub } = useUserContext();
  const { setShowOnboarding } = useModalContext();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { logout } = useAuth();

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
      await logout();
    } catch (err) {
      console.error("Logout API call failed, clearing local state anyway:", err);
    }
    setProfileCompleted(false);
    setUserEmail(null);
  }, [logout, setProfileCompleted, setUserEmail]);

  const handleSignIn = useCallback(() => {
    navigate(ROUTES.LOGIN);
    setShowOnboarding(false);
  }, [navigate, setShowOnboarding]);

  return (
    <header className="flex items-center justify-between fixed top-0 left-0 right-0 h-12 pl-5 pr-5 border-b border-border bg-sidebar z-nav">
      <div className="flex items-center gap-2.5">
        <button
          onClick={handleLogoClick}
          className="h-6 w-6 shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
          aria-label={t("navigation.goToEvents")}
        >
          <img
            alt={t("common.logo")}
            className="w-full h-full object-cover rounded"
            src={imgImage1}
          />
        </button>
        <span className="text-muted-foreground text-lg font-light">/</span>
        <SchoolCombobox value={selectedSchool} onChange={setSelectedSchool} />
      </div>

      <div className="flex items-center gap-2">
        {/* Admin Button – only visible to admins */}
        {profileCompleted && isAdmin && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="secondary" size="sm" onClick={handleAdminClick}>
                <Shield className="w-4 h-4" strokeWidth={2.5} />
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
                <Building2 className="w-4 h-4" strokeWidth={2.5} />
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
                <LogOut className="w-4 h-4" strokeWidth={2.5} />
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
