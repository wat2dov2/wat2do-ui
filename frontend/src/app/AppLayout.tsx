import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  Mail,
  Settings,
  OrganizationChart,
  Ticket,
  QrCode,
} from "@/shared/ui/doodle-icons";
import { TopNav } from "@/app/TopNav";
import { FloatingDock } from "@/shared/ui/floating-dock";
import type { FloatingDockItem } from "@/shared/ui/floating-dock";
import { BackToTopButton } from "@/shared/ui/back-to-top-button";
import { ROUTES } from "@/shared/constants/routes";
import { usePromoterState } from "@/features/posters";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const promoter = usePromoterState();

  const isActive = (href?: string) => {
    if (!href) return false;
    if (href === ROUTES.HOME) return pathname === ROUTES.HOME;
    return pathname.startsWith(href);
  };

  const dockItems: FloatingDockItem[] = [
    {
      title: t("navigation.events"),
      icon: <Ticket className="size-full" />,
      href: ROUTES.HOME,
      isActive: isActive(ROUTES.HOME),
    },
    {
      title: t("navigation.organizations"),
      icon: <OrganizationChart className="size-full" />,
      href: ROUTES.ORGANIZATIONS,
      isActive: isActive(ROUTES.ORGANIZATIONS),
    },
    {
      title: t("navigation.contact"),
      icon: <Mail className="size-full" />,
      href: ROUTES.CONTACT,
      isActive: isActive(ROUTES.CONTACT),
    },
    ...(promoter.isAuthenticated
      ? [
          {
            title: t("navigation.posters"),
            icon: <QrCode className="size-full" />,
            href: promoter.isEnrolled ? ROUTES.POSTERS : ROUTES.PROMOTE,
            isActive:
              isActive(ROUTES.POSTERS) || isActive(ROUTES.PROMOTE),
          },
          {
            title: t("navigation.settings"),
            icon: <Settings className="size-full" />,
            href: ROUTES.SETTINGS,
            isActive: isActive(ROUTES.SETTINGS),
          },
        ]
      : []),
  ];

  return (
    <div className="h-dvh flex flex-col">
      <TopNav />

      <div
        className="main-content-grid mt-12 flex-1 overflow-auto px-2 pt-4 pb-20 sm:p-4 sm:pb-16"
        style={{
          minHeight: "calc(100vh - 48px)",
        }}
      >
        {children}
      </div>

      {/* Shared bottom chrome: dock centered, back-to-top on the right, same icon baseline. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex h-16 items-end justify-center px-2 pb-3 sm:px-4">
        <div className="pointer-events-auto max-w-[calc(100vw-16px)]">
          <FloatingDock items={dockItems} />
        </div>
        <div className="pointer-events-auto absolute right-2 bottom-3 sm:right-4">
          <BackToTopButton />
        </div>
      </div>
    </div>
  );
}
