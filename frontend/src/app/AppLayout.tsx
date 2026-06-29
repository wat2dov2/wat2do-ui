import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  Mail,
  Settings,
  Compass,
  Plus,
  OrganizationChart,
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
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated } = useAuthState();
  const setShowSubmitChoice = useUIStore((s) => s.setShowSubmitChoice);

  const isActive = (href?: string) => {
    if (!href) return false;
    if (href === ROUTES.HOME) return pathname === ROUTES.HOME;
    return pathname.startsWith(href);
  };

  const isOrganizationPanel = pathname.startsWith(ROUTES.ORGANIZATION_PANEL);

  const dockItems: FloatingDockItem[] = [
    {
      title: t("navigation.explore"),
      icon: <Compass className="size-4" />,
      href: ROUTES.HOME,
      onMouseDown: () => router.push(ROUTES.HOME),
      isActive: isActive(ROUTES.HOME),
    },
    ...(!isOrganizationPanel
      ? [
          {
            title: t("navigation.create"),
            icon: <Plus className="size-4" />,
            onMouseDown: () => setShowSubmitChoice(true),
          },
        ]
      : []),
    {
      title: t("navigation.organizations"),
      icon: <OrganizationChart className="size-4" />,
      href: ROUTES.ORGANIZATIONS,
      onMouseDown: () => router.push(ROUTES.ORGANIZATIONS),
      isActive: isActive(ROUTES.ORGANIZATIONS),
    },
    {
      title: t("navigation.contact"),
      icon: <Mail className="size-4" />,
      href: ROUTES.CONTACT,
      onMouseDown: () => router.push(ROUTES.CONTACT),
      isActive: isActive(ROUTES.CONTACT),
    },
    ...(isAuthenticated
      ? [
          {
            title: t("navigation.settings"),
            icon: <Settings className="size-4" />,
            href: ROUTES.SETTINGS,
            onMouseDown: () => router.push(ROUTES.SETTINGS),
            isActive: isActive(ROUTES.SETTINGS),
          },
        ]
      : []),
  ];

  return (
    <div className="h-dvh flex flex-col">
      <TopNav />

      <div
        className="main-content-grid mt-12 flex-1 overflow-auto px-2 pt-4 pb-28 sm:p-4 sm:pb-24"
        style={{
          minHeight: "calc(100vh - 48px)",
        }}
      >
        {children}
      </div>

      {/* Floating Dock — bottom center */}
      <div className="fixed bottom-4 left-1/2 z-50 w-fit max-w-[calc(100vw-16px)] -translate-x-1/2">
        <FloatingDock items={dockItems} />
      </div>
    </div>
  );
}
