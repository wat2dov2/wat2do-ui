import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Search,
  ChevronDown,
  CalendarDays,
  Compass,
  Plus,
  Shield,
  Target,
  Mail,
  Settings,
  LogOut,
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { SchoolCombobox } from "@/components/SchoolCombobox";
import { AnimatedThemeToggler } from "@/components/AnimatedThemeToggler";
import { LanguageSelector } from "@/components/LanguageSelector";
import { InteractiveHoverButton } from "@/components/ui/interactive-hover-button";
import imgImage1 from "@/assets/38e8096a28295e8dcc0e5020d0a5f3dd85d5f019.png";
import type { PageMode } from "@/types";

interface NavButtonProps {
  icon: React.ComponentType<{
    className?: string;
    strokeWidth?: number | string;
  }>;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
  expanded: boolean;
}

function NavButton({
  icon: Icon,
  label,
  isActive = false,
  onClick,
  expanded,
}: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`font-medium text-[11px] rounded-xl text-left flex items-center px-2 py-1.5 gap-2 w-full cursor-pointer ${
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" strokeWidth={2} />
      <span
        className="whitespace-nowrap transition-opacity duration-150"
        style={{ opacity: expanded ? 1 : 0 }}
      >
        {label}
      </span>
    </button>
  );
}

interface AppLayoutProps {
  children: React.ReactNode;
  pageMode: PageMode;
  sidebarHovered: boolean;
  setSidebarHovered: (hovered: boolean) => void;
  eventsExpanded: boolean;
  setEventsExpanded: (expanded: boolean) => void;
  selectedSchool: string;
  setSelectedSchool: (school: string) => void;
  profileCompleted: boolean;
  setProfileCompleted: (completed: boolean) => void;
  setUserEmail: (email: string | null) => void;
  showCommandPalette: boolean;
  setShowCommandPalette: (show: boolean) => void;
  setShowOnboarding: (show: boolean) => void;
  setShowSubmitEvent: (show: boolean) => void;
}

export function AppLayout({
  children,
  pageMode,
  sidebarHovered,
  setSidebarHovered,
  eventsExpanded,
  setEventsExpanded,
  selectedSchool,
  setSelectedSchool,
  profileCompleted,
  setProfileCompleted,
  setUserEmail,
  showCommandPalette,
  setShowCommandPalette,
  setShowOnboarding,
  setShowSubmitEvent,
}: AppLayoutProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="h-dvh flex flex-col">
      {/* Top Navigation */}
      <header className="flex items-center justify-between fixed top-0 left-0 right-0 h-12 pl-5 pr-5 border-b border-border bg-sidebar z-50">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => navigate("/")}
            className="h-6 w-6 shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
            aria-label="Go to events"
          >
            <img
              alt="Logo"
              className="w-full h-full object-cover rounded"
              src={imgImage1}
            />
          </button>
          <span className="text-muted-foreground text-lg font-light">/</span>
          <SchoolCombobox value={selectedSchool} onChange={setSelectedSchool} />
        </div>

        <div className="flex items-center gap-2">
          {/* Admin Button - Always visible */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => navigate("/admin")}
                className="flex items-center gap-1.5 bg-muted hover:bg-gray-200 text-foreground font-medium text-sm px-3 py-1.5 rounded-xl transition-colors cursor-pointer"
              >
                <Shield className="w-4 h-4" strokeWidth={2.5} />
                {t("navigation.admin")}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("navigation.adminPanel")}</p>
            </TooltipContent>
          </Tooltip>

          {/* Language Selector */}
          <LanguageSelector />

          {/* Dark Mode Toggle */}
          <AnimatedThemeToggler />

          {/* Auth Button */}
          {profileCompleted ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    setProfileCompleted(false);
                    setUserEmail(null);
                  }}
                  className="flex items-center gap-1.5 bg-muted hover:bg-gray-200 text-foreground font-medium text-sm px-3 py-1.5 rounded-xl transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4" strokeWidth={2.5} />
                  {t("modals.signOut.logOut")}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("modals.signOut.signOutOfAccount")}</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <InteractiveHoverButton
                  onClick={() => setShowOnboarding(true)}
                  className="flex items-center gap-1.5 bg-primary border-primary text-white font-medium text-sm px-6 py-1.5 min-w-[120px] justify-center"
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

      <div className="flex overflow-hidden flex-1">
        {/* Side Navigation */}
        <aside
          onMouseEnter={() => setSidebarHovered(true)}
          onMouseLeave={() => setSidebarHovered(false)}
          className="flex flex-col transition-all duration-200 overflow-hidden fixed left-0 top-12 bottom-0 border-r border-border bg-sidebar z-40"
          style={{
            width: sidebarHovered ? "180px" : "48px",
          }}
        >
          <div className="p-2">
            <nav className="flex flex-col gap-1">
              {/* Command Palette Trigger - Above Events */}
              <button
                onClick={() => setShowCommandPalette(true)}
                className="w-full font-medium text-[11px] rounded-xl text-left flex items-center px-2 py-1.5 gap-2 text-muted-foreground hover:bg-gray-200 hover:text-gray-800 mb-1"
              >
                <Search className="w-4 h-4 shrink-0" strokeWidth={2} />
                <span
                  className="flex-1 whitespace-nowrap transition-opacity duration-150"
                  style={{ opacity: sidebarHovered ? 1 : 0 }}
                >
                  {t("common.search")}
                </span>
                {sidebarHovered && (
                  <div className="flex items-center gap-0.5">
                    <span className="flex items-center justify-center w-[18px] h-[18px] bg-muted border border-border rounded shadow-sm text-[9px] text-muted-foreground">
                      ⌘
                    </span>
                    <span className="flex items-center justify-center w-[18px] h-[18px] bg-muted border border-border rounded shadow-sm text-[9px] text-muted-foreground">
                      K
                    </span>
                  </div>
                )}
              </button>

              {/* Events Section - Different for logged in/out */}
              {profileCompleted ? (
                /* Logged In: Expandable Events with sublinks */
                <div
                  className={`rounded-xl ${
                    pageMode === "events" ? "bg-gray-100" : "bg-transparent"
                  }`}
                >
                  <button
                    onClick={() => setEventsExpanded(!eventsExpanded)}
                    className={`w-full font-medium text-[11px] rounded-xl text-left flex items-center px-2 py-1.5 gap-2 ${
                      pageMode === "events"
                        ? "text-gray-900"
                        : "text-muted-foreground hover:bg-gray-200 hover:text-gray-800"
                    }`}
                  >
                    <CalendarDays
                      className="w-4 h-4 shrink-0"
                      strokeWidth={2}
                    />
                    <span
                      className="flex-1 whitespace-nowrap transition-opacity duration-150"
                      style={{ opacity: sidebarHovered ? 1 : 0 }}
                    >
                      {t("navigation.events")}
                    </span>
                    {sidebarHovered && (
                      <ChevronDown
                        className="w-3 h-3 shrink-0 transition-transform duration-200"
                        style={{
                          transform: eventsExpanded
                            ? "rotate(0deg)"
                            : "rotate(-90deg)",
                        }}
                        strokeWidth={2}
                      />
                    )}
                  </button>

                  {/* Sublinks */}
                  <div
                    className="overflow-hidden transition-all duration-200"
                    style={{
                      maxHeight: eventsExpanded ? "120px" : "0px",
                      opacity: eventsExpanded ? 1 : 0,
                    }}
                  >
                    <div
                      className="flex flex-col gap-0.5 mt-0.5"
                      style={{ paddingLeft: sidebarHovered ? "20px" : "0px" }}
                    >
                      <button
                        onClick={() => navigate("/")}
                        className={`font-medium text-[11px] rounded-xl text-left flex items-center px-2 py-1.5 gap-2 ${
                          pageMode === "events"
                            ? "bg-gray-100 text-gray-900"
                            : "text-muted-foreground hover:bg-gray-200 hover:text-gray-800"
                        }`}
                      >
                        <Compass
                          className="w-4 h-4 shrink-0"
                          strokeWidth={2}
                        />
                        <span
                          className="whitespace-nowrap transition-opacity duration-150"
                          style={{ opacity: sidebarHovered ? 1 : 0 }}
                        >
                          {t("navigation.explore")}
                        </span>
                      </button>
                      <button
                        onClick={() => setShowSubmitEvent(true)}
                        className="font-medium text-[11px] rounded-xl text-left flex items-center px-2 py-1.5 gap-2 text-muted-foreground hover:bg-gray-200 hover:text-gray-800"
                      >
                        <Plus
                          className="w-4 h-4 shrink-0"
                          strokeWidth={2}
                        />
                        <span
                          className="whitespace-nowrap transition-opacity duration-150"
                          style={{ opacity: sidebarHovered ? 1 : 0 }}
                        >
                          {t("navigation.create")}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* Logged Out: Simple Events link */
                <button
                  onClick={() => navigate("/")}
                  className={`w-full font-medium text-[11px] rounded-xl text-left flex items-center px-2 py-1.5 gap-2 ${
                    pageMode === "events"
                      ? "bg-gray-100 text-gray-900"
                      : "text-muted-foreground hover:bg-gray-100 hover:text-gray-800"
                  }`}
                >
                  <CalendarDays
                    className="w-4 h-4 shrink-0"
                    strokeWidth={2}
                  />
                  <span
                    className="flex-1 whitespace-nowrap transition-opacity duration-150"
                    style={{ opacity: sidebarHovered ? 1 : 0 }}
                  >
                    {t("navigation.events")}
                  </span>
                </button>
              )}

              <NavButton
                icon={Shield}
                label={t("navigation.clubs")}
                isActive={pageMode === "clubs"}
                onClick={() => navigate("/clubs")}
                expanded={sidebarHovered}
              />
              <NavButton
                icon={Target}
                label={t("navigation.mission")}
                isActive={pageMode === "about"}
                onClick={() => navigate("/about")}
                expanded={sidebarHovered}
              />
              <NavButton
                icon={Mail}
                label={t("navigation.contact")}
                expanded={sidebarHovered}
              />
            </nav>
          </div>

          {/* Settings Section - Only show when logged in */}
          {profileCompleted && (
            <div className="mt-auto p-2 border-t border-border">
              <button
                onClick={() => navigate("/settings")}
                className="w-full font-medium text-[11px] rounded-xl text-left flex items-center px-2 py-1.5 gap-2 text-muted-foreground hover:bg-gray-200 hover:text-gray-800"
              >
                <Settings className="w-4 h-4 shrink-0" strokeWidth={2} />
                <span
                  className="whitespace-nowrap transition-opacity duration-150"
                  style={{ opacity: sidebarHovered ? 1 : 0 }}
                >
                  {t("navigation.settings")}
                </span>
              </button>
            </div>
          )}
        </aside>

        {/* Main Content */}
        <div
          className="flex-1 overflow-auto ml-12 mt-12 p-6 main-content-grid"
          style={{
            minHeight: "calc(100vh - 48px)",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
