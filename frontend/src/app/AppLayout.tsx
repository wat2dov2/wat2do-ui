import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import {
  Search,
  Mail,
  Settings,
  Compass,
  Plus,
  Users,
} from "@/shared/ui/doodle-icons";
import { TopNav } from "@/app/TopNav";
import { FloatingDock } from "@/shared/ui/floating-dock";
import type { FloatingDockItem } from "@/shared/ui/floating-dock";
import { useAuthState } from "@/features/auth";
import { useUIStore } from "@/shared/store/ui.store";
import { ROUTES } from "@/shared/constants/routes";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { isAuthenticated } = useAuthState();
  const setShowCommandPalette = useUIStore((s) => s.setShowCommandPalette);
  const setShowSubmitEvent = useUIStore((s) => s.setShowSubmitEvent);

  const isActive = (href?: string) => {
    if (!href) return false;
    if (href === ROUTES.HOME) return pathname === ROUTES.HOME;
    return pathname.startsWith(href);
  };

  const isOrganizationPanel = pathname.startsWith(ROUTES.ORGANIZATION_PANEL);

  const dockItems: FloatingDockItem[] = [
    {
      title: t("common.search"),
      icon: <Search className="size-4" />,
      onMouseDown: () => setShowCommandPalette(true),
    },
    {
      title: t("navigation.explore"),
      icon: <Compass className="size-4" />,
      href: ROUTES.HOME,
      isActive: isActive(ROUTES.HOME),
    },
    ...(!isOrganizationPanel
      ? [
          {
            title: t("navigation.create"),
            icon: <Plus className="size-4" />,
            onMouseDown: () => setShowSubmitEvent(true),
          },
        ]
      : []),
    {
      title: t("navigation.organizations"),
      icon: <Users className="size-4" />,
      href: ROUTES.ORGANIZATIONS,
      isActive: isActive(ROUTES.ORGANIZATIONS),
    },
    {
      title: t("navigation.contact"),
      icon: <Mail className="size-4" />,
      href: ROUTES.CONTACT,
      isActive: isActive(ROUTES.CONTACT),
    },
    ...(isAuthenticated
      ? [
          {
            title: t("navigation.settings"),
            icon: <Settings className="size-4" />,
            href: ROUTES.SETTINGS,
            isActive: isActive(ROUTES.SETTINGS),
          },
        ]
      : []),
  ];

  return (
    <div className="h-dvh flex flex-col">
      <TopNav />

      {/* Main Content */}
      <div
        className="flex-1 overflow-auto mt-12 p-6 main-content-grid"
        style={{
          minHeight: "calc(100vh - 48px)",
        }}
      >
        {children}
      </div>

      {/* Floating Dock — bottom center */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
        <FloatingDock items={dockItems} />
      </div>
    </div>
  );
}
