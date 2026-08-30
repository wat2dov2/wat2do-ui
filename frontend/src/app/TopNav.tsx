import { useCallback, useState } from "react";
import Image from "next/image";
import NextLink from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  HelpCircle,
  LogOut,
  MoreHorizontal,
  OrganizationChart,
  Settings,
  Shield,
  Ticket,
  Users,
} from "@/shared/ui/doodle-icons";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/shared/ui/tooltip";
import { Button } from "@/shared/ui/button";
import { SchoolCombobox } from "@/shared/ui/school-combobox";
import { SearchCombobox } from "@/shared/ui/search-combobox";
import { LanguageSelector } from "@/shared/ui/language-selector";
import { ThemeToggle } from "@/shared/ui/theme-toggle";
import { Separator } from "@/shared/ui/separator";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import { DrawerBody } from "@/shared/layout";
import { useAuthState, type AuthState } from "@/features/auth/hooks/useAuthState";
import { useRequestSchool } from "@/app/client-providers";
import { getUserProfile, logoutAPI, updateUserProfile } from "@/features/auth/api/auth.api";
import { ROUTES } from "@/shared/constants/routes";
import { getSchoolOrigin } from "@/shared/constants/schools";
import imgImage1 from "@/assets/38e8096a28295e8dcc0e5020d0a5f3dd85d5f019.png";

type NavOrganization = AuthState["clubs"][number];

const PRIMARY_NAV_ITEMS = [
  { labelKey: "navigation.events", href: ROUTES.HOME, Icon: Ticket },
  {
    labelKey: "navigation.organizations",
    href: ROUTES.ORGANIZATIONS,
    Icon: OrganizationChart,
  },
  {
    labelKey: "navigation.positions",
    href: ROUTES.POSITIONS,
    Icon: Users,
  },
  { labelKey: "navigation.about", href: ROUTES.CONTACT, Icon: HelpCircle },
] as const;

const SETTINGS_NAV_ITEM = {
  labelKey: "navigation.settings",
  href: ROUTES.SETTINGS,
  Icon: Settings,
} as const;

function isRouteActive(pathname: string, href: string): boolean {
  if (href === ROUTES.HOME) return pathname === ROUTES.HOME;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TopNav() {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const requestSchool = useRequestSchool();
  const { isAuthenticated, profileCompleted, isAdmin, clubs, organizationId } =
    useAuthState();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const activeOrganization = clubs.find((club) => club.id === organizationId) ?? clubs[0];
  const canOpenOrganizationPanel = profileCompleted && Boolean(activeOrganization);
  const navigationItems = isAuthenticated
    ? [...PRIMARY_NAV_ITEMS, SETTINGS_NAV_ITEM]
    : PRIMARY_NAV_ITEMS;

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
      // Every school lives on its own origin, so switching is a cross-origin navigation.
      window.location.assign(getSchoolOrigin(school));
    },
    [],
  );

  return (
    <header className="fixed top-0 left-0 right-0 z-nav flex h-12 items-center justify-between gap-1.5 border-b border-border bg-surface px-2 sm:gap-2 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2.5">
        <button
          onMouseDown={handleLogoClick}
          className="flex h-8 w-10 shrink-0 cursor-pointer items-center justify-center transition-opacity hover:opacity-80"
          aria-label={t("navigation.goToEvents")}
        >
          <Image
            alt={t("common.logo")}
            width={34}
            height={24}
            className="h-6 w-[34px] object-contain"
            src={imgImage1}
          />
        </button>
        <span className="hidden text-muted-foreground text-lg font-light sm:inline">/</span>
        <SchoolCombobox
          value={requestSchool}
          onChange={handleSchoolChange}
          triggerClassName="pl-1 pr-2 sm:pl-1.5 sm:pr-3"
        />
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <nav
          aria-label={t("navigation.primary")}
          className="hidden items-center gap-0.5 xl:flex"
        >
          {navigationItems.map(({ labelKey, href }) => {
            const active = isRouteActive(pathname, href);
            return (
              <Button
                key={href}
                asChild
                variant={active ? "outline" : "ghost"}
                size="sm"
              >
                <NextLink href={href} aria-current={active ? "page" : undefined}>
                  {t(labelKey)}
                </NextLink>
              </Button>
            );
          })}
        </nav>

        <Drawer
          open={navigationOpen}
          onOpenChange={setNavigationOpen}
          direction="right"
        >
          <Button
            variant="outline"
            size="icon-sm"
            className="xl:hidden"
            aria-label={t("navigation.openMenu")}
            onClick={() => setNavigationOpen(true)}
          >
            <MoreHorizontal className="size-4" />
          </Button>
          <DrawerContent aria-describedby={undefined}>
            <DrawerHeader className="sr-only">
              <DrawerTitle>{t("navigation.primary")}</DrawerTitle>
            </DrawerHeader>
            <DrawerBody className="gap-1 pt-0">
              {!profileCompleted && (
                <Button
                  className="w-full"
                  onClick={() => {
                    setNavigationOpen(false);
                    handleSignIn();
                  }}
                >
                  {t("events.signIn")}
                </Button>
              )}
              <nav
                aria-label={t("navigation.primary")}
                className="flex flex-col gap-1"
              >
                {navigationItems.map(({ labelKey, href, Icon }) => {
                  const active = isRouteActive(pathname, href);
                  return (
                    <Button
                      key={href}
                      asChild
                      variant={active ? "outline" : "ghost"}
                      className="w-full justify-start"
                    >
                      <NextLink
                        href={href}
                        aria-current={active ? "page" : undefined}
                        onClick={() => setNavigationOpen(false)}
                      >
                        <Icon />
                        {t(labelKey)}
                      </NextLink>
                    </Button>
                  );
                })}
              </nav>
            </DrawerBody>
            <Separator />
            <DrawerFooter>
              <div className="flex items-center justify-between gap-2">
                <LanguageSelector />
                <ThemeToggle />
              </div>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>

        {profileCompleted && isAdmin && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
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
          <SearchCombobox
            selectedKey={activeOrganization.id}
            onSelect={handleOrganizationSelect}
            items={clubs}
            getKey={(organization) => organization.id}
            getLabel={(organization) => organization.organization_name}
            displayValue={activeOrganization.organization_name}
            variant="nav"
            align="end"
            searchPlaceholder={t("organizations.searchPlaceholder")}
            emptyLabel={t("organizations.noClubsFound")}
            triggerClassName="max-w-[24vw] sm:max-w-[180px] md:max-w-[240px]"
          />
        )}

        <div className="hidden items-center gap-2 xl:flex">
          <Separator
            orientation="vertical"
            data-nav-preferences-divider
            className="ml-0.5 mr-1.5 data-[orientation=vertical]:h-6"
          />
          <LanguageSelector />
          <ThemeToggle />
        </div>

        {profileCompleted ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onMouseDown={handleSignOut} className="size-8 px-0 sm:w-auto sm:px-3">
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
              <Button
                size="sm"
                className="hidden xl:inline-flex"
                onMouseDown={handleSignIn}
              >
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
