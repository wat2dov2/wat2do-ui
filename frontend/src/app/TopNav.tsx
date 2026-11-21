import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import navLogo from "@/assets/wat2do-logo-nav.webp";
import NextLink from "next/link";
import { Link } from "@/shared/ui/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ChevronDown, CircleUser, HelpCircle, Menu, Plus, Shapes, Ticket, Users } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/shared/ui/tooltip";
import { Button } from "@/shared/ui/button";
import { LazyImage } from "@/shared/ui/lazy-image";
import { SchoolCombobox } from "@/shared/ui/school-combobox";
import { LanguageSelector } from "@/shared/ui/language-selector";
import { ThemeToggle } from "@/shared/ui/theme-toggle";
import { Separator } from "@/shared/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import { DrawerBody, Stack } from "@/shared/layout";
import { SessionView } from "@/features/auth/components/SessionView";
import { useAuthState, useSessionKnown } from "@/features/auth/hooks/useAuthState";
import { NotificationBell } from "@/features/notifications";
import { useRequestSchool } from "@/app/client-providers";
import { prefetchPublicPage } from "@/app/hooks/useAppNavigation";
import { PUBLIC_PAGE_ROUTES, ROUTES } from "@/shared/constants/routes";
import { getSchoolOrigin } from "@/shared/constants/schools";
import { MAIN_CONTENT_SCROLL_ROOT_SELECTOR } from "@/shared/constants/ui";

/** The empty element that closes the header, which the first paint waits for (see the expect link below). */
const TOP_NAV_END_ID = "top-nav-end";

interface Wat2DoLogoLinkProps {
  label: string;
  onNavigate?: () => void;
}

function Wat2DoLogoLink({ label, onNavigate }: Wat2DoLogoLinkProps) {
  const router = useRouter();
  const prefetch = () => prefetchPublicPage(router, ROUTES.EVENTS);
  return (
    <Link
      variant="navigation"
      href={ROUTES.EVENTS}
      prefetch={false}
      onPointerEnter={prefetch}
      onFocus={prefetch}
      onTouchStart={prefetch}
      onClick={onNavigate}
      className="flex h-8 w-10 shrink-0 cursor-pointer items-center justify-center transition-opacity hover:opacity-80"
      aria-label={label}
    >
      {/* It opens every page's first paint: a lazy image only starts loading after that
          paint, and an async decode leaves it out of the frame that shows the bar. */}
      <Image
        alt=""
        width={34}
        height={24}
        loading="eager"
        decoding="sync"
        className="h-6 w-[34px] object-contain"
        src={navLogo}
      />
    </Link>
  );
}

const PRIMARY_NAV_ITEMS = [
  { labelKey: "navigation.events", href: ROUTES.EVENTS, Icon: Ticket },
  {
    labelKey: "navigation.positions",
    href: ROUTES.POSITIONS,
    Icon: Users,
  },
  {
    labelKey: "navigation.clubs",
    href: ROUTES.CLUBS,
    Icon: Shapes,
  },
  { labelKey: "navigation.about", href: ROUTES.ABOUT, Icon: HelpCircle },
] as const;

/** A signed-in visitor's own page: their avatar opens it on a wide screen, and the side menu lists it on a narrower one. */
const PROFILE_NAV_ITEM = { labelKey: "navigation.profile", href: ROUTES.PROFILE, Icon: CircleUser } as const;

type NavigationItem = (typeof PRIMARY_NAV_ITEMS)[number] | typeof PROFILE_NAV_ITEM;

/**
 * Every submission form, which the Submit menu and the footer list. Each is
 * open to everyone, signed in or not, and asks for sign-in itself at submit.
 */
export const SUBMISSION_FORMS = [
  { labelKey: "events.submitEvent", href: ROUTES.EVENT_SUBMIT, Icon: Ticket },
  { labelKey: "positions.addPosition", href: ROUTES.POSITION_SUBMIT, Icon: Users },
  { labelKey: "clubs.addClub", href: ROUTES.CLUB_CREATE, Icon: Shapes },
] as const;

interface SubmitMenuProps {
  size: "sm" | "navigation";
  onNavigate?: () => void;
}

/** The way into every submission form: a menu of what to submit. */
function SubmitMenu({ size, onNavigate }: SubmitMenuProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const active = SUBMISSION_FORMS.some(({ href }) => isRouteActive(pathname, href));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={active ? "outline" : "ghost"} size={size}>
          {size === "navigation" ? <Plus /> : null}
          <span className="min-w-0 flex-1 truncate text-start">{t("navigation.submit")}</span>
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SUBMISSION_FORMS.map(({ labelKey, href, Icon }) => (
          <DropdownMenuItem
            key={href}
            onSelect={() => {
              onNavigate?.();
              router.push(href);
            }}
          >
            <Icon />
            {t(labelKey)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface NavigationLinkProps {
  item: NavigationItem;
  size: "sm" | "navigation";
  onNavigate?: () => void;
}

/** A link to one page, marked while that page is open and loaded ahead as soon as the visitor reaches for it. */
function NavigationLink({ item: { labelKey, href, Icon }, size, onNavigate }: NavigationLinkProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const active = isRouteActive(pathname, href);
  const prefetch = () => prefetchPublicPage(router, href);
  return (
    <Button asChild variant={active ? "outline" : "ghost"} size={size}>
      <NextLink
        href={href}
        prefetch={PUBLIC_PAGE_ROUTES.includes(href) ? false : undefined}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        onTouchStart={prefetch}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
      >
        {size === "navigation" ? <Icon /> : null}
        {t(labelKey)}
      </NextLink>
    </Button>
  );
}

/** The navigation's height in CSS pixels (`h-12`). */
const NAV_HEIGHT = 48;

/**
 * Whether the page has scrolled its band under the navigation (`PageBleed
 * underNav`) out from beneath it. Until then the navigation is see-through
 * over the band; pages without one are unaffected.
 */
function useScrolledPastBand(pathname: string): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(MAIN_CONTENT_SCROLL_ROOT_SELECTOR);
    if (!root) return;
    const sync = () => {
      const band = root.querySelector<HTMLElement>("[data-under-nav]");
      setPast(band !== null && root.scrollTop >= band.offsetHeight - NAV_HEIGHT);
    };
    sync();
    root.addEventListener("scroll", sync, { passive: true });
    return () => root.removeEventListener("scroll", sync);
  }, [pathname]);
  return past;
}

function isRouteActive(pathname: string, href: string): boolean {
  if (href === ROUTES.EVENTS) return pathname === ROUTES.EVENTS;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TopNav() {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const requestSchool = useRequestSchool();
  const { isAuthenticated, userAvatarUrl, userEmail } = useAuthState();
  const sessionKnown = useSessionKnown();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const scrolledPastBand = useScrolledPastBand(pathname);
  const onProfile = isRouteActive(pathname, ROUTES.PROFILE);
  const userInitial = (userEmail?.[0] ?? "?").toUpperCase();
  // The visitor's picture or initial is known once the page wakes up.
  const userAvatar = !sessionKnown ? null : userAvatarUrl ? (
    <LazyImage src={userAvatarUrl} alt="" width={32} height={32} fallback={userInitial} className="size-full" />
  ) : userInitial;
  const openNavigation = useCallback(() => setNavigationOpen(true), []);
  const closeNavigation = useCallback(() => setNavigationOpen(false), []);

  const handleSignIn = useCallback(() => {
    router.push(ROUTES.LOGIN);
  }, [router]);

  const prefetchSignIn = useCallback(() => {
    prefetchPublicPage(router, ROUTES.LOGIN);
  }, [router]);

  const handleSchoolChange = useCallback(
    (school: string) => {
      // Every school lives on its own origin, so switching is a cross-origin navigation.
      window.location.assign(getSchoolOrigin(school));
    },
    [],
  );

  return (
    // Over a band under the navigation it is see-through, with no rule, until the band scrolls away.
    <header
      data-slot="top-nav"
      data-scrolled={scrolledPastBand ? true : undefined}
      className="fixed top-0 left-0 right-0 z-nav flex h-12 items-center justify-between gap-1.5 border-b border-border bg-surface px-2 transition-[background-color,border-color] duration-200 sm:gap-2 sm:px-4 group-has-[[data-under-nav]]/app:not-data-scrolled:border-transparent group-has-[[data-under-nav]]/app:not-data-scrolled:bg-transparent"
    >
      {/*
        Chromium paints as soon as its HTML parser pauses, which on a slow CPU
        can fall inside this header: the first frame showed the primary
        navigation alone, then the controls parsed after it pushed it aside.
        This link holds the first paint until the parser reaches the empty
        marker that closes the header. Chromium lets go as soon as the target
        element is inserted, so the target is that last marker, not the header.
        React hoists the link into <head>, the only place it takes effect.
      */}
      <link rel="expect" href={`#${TOP_NAV_END_ID}`} blocking="render" />
      <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2.5">
        <Wat2DoLogoLink label={t("navigation.events")} />
        <span className="hidden text-muted-foreground text-lg font-light sm:inline">/</span>
        <SchoolCombobox
          value={requestSchool}
          onChange={handleSchoolChange}
          triggerClassName="pl-1 pr-2 sm:pl-1.5 sm:pr-3"
        />
      </div>

      {/*
        From the `nav` breakpoint up (`--breakpoint-nav` in index.css), signed
        in or out, the bar holds the same pages, Submit, language and theme.
        Only what follows differs: Sign in, or the visitor's bell and avatar,
        which opens their profile. Below it the bar has room only for the bell
        and a button that opens the side menu: the avatar, or the menu icon. The
        server cannot know who is visiting, so those are SessionView looks: the
        bar a signed-in visitor first sees is already their own, never Sign in
        turning into an avatar once the page wakes up.
      */}
      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        <nav
          aria-label={t("navigation.primary")}
          className="hidden items-center gap-0.5 nav:flex"
        >
          {PRIMARY_NAV_ITEMS.map((item) => (
            <NavigationLink key={item.href} item={item} size="sm" />
          ))}
          <SubmitMenu size="sm" />
        </nav>

        <div className="hidden items-center gap-2 nav:flex">
          <Separator
            orientation="vertical"
            data-nav-preferences-divider
            className="ml-0.5 mr-1.5 data-[orientation=vertical]:h-6"
          />
          <LanguageSelector />
          <ThemeToggle />
        </div>

        <SessionView
          signedIn={
            <>
              <NotificationBell />
              <Button asChild variant="avatar" size="icon-sm" className="hidden nav:inline-flex">
                <NextLink
                  href={ROUTES.PROFILE}
                  aria-label={t("navigation.profile")}
                  aria-current={onProfile ? "page" : undefined}
                >
                  {userAvatar}
                </NextLink>
              </Button>
              <Button
                variant="avatar"
                size="icon-sm"
                className="nav:hidden"
                aria-label={t("navigation.openMenu")}
                aria-haspopup="dialog"
                aria-expanded={navigationOpen}
                onClick={openNavigation}
              >
                {userAvatar}
              </Button>
            </>
          }
          signedOut={
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    className="hidden nav:inline-flex"
                    onPointerEnter={prefetchSignIn}
                    onFocus={prefetchSignIn}
                    onTouchStart={prefetchSignIn}
                    onMouseDown={handleSignIn}
                  >
                    {t("events.signIn")}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("modals.signIn.signInToSavePreferences")}</p>
                </TooltipContent>
              </Tooltip>
              <Button
                variant="outline"
                size="icon-sm"
                className="nav:hidden"
                aria-label={t("navigation.openMenu")}
                aria-haspopup="dialog"
                aria-expanded={navigationOpen}
                onClick={openNavigation}
              >
                <Menu />
              </Button>
            </>
          }
        />

        {/* The side menu below the `nav` breakpoint: the pages and Submit its bar has no room for, and the visitor's profile. */}
        <Drawer
          open={navigationOpen}
          onOpenChange={setNavigationOpen}
          direction="right"
        >
          <DrawerContent aria-describedby={undefined}>
            <DrawerHeader className="sr-only">
              <DrawerTitle>{t("navigation.primary")}</DrawerTitle>
            </DrawerHeader>
            <DrawerBody className="gap-3">
              <Stack direction="horizontal" align="center" justify="between" gap={2}>
                <Wat2DoLogoLink
                  label={t("navigation.events")}
                  onNavigate={closeNavigation}
                />
                <Stack direction="horizontal" align="center" gap={2}>
                  <LanguageSelector />
                  <ThemeToggle />
                </Stack>
              </Stack>
              <Separator />
              {!isAuthenticated && (
                <>
                  <Button
                    className="w-full"
                    onPointerEnter={prefetchSignIn}
                    onFocus={prefetchSignIn}
                    onTouchStart={prefetchSignIn}
                    onClick={() => {
                      setNavigationOpen(false);
                      handleSignIn();
                    }}
                  >
                    {t("events.signIn")}
                  </Button>
                  <Separator />
                </>
              )}
              <nav
                aria-label={t("navigation.primary")}
                className="flex flex-col gap-1"
              >
                {PRIMARY_NAV_ITEMS.map((item) => (
                  <NavigationLink key={item.href} item={item} size="navigation" onNavigate={closeNavigation} />
                ))}
                <SubmitMenu size="navigation" onNavigate={closeNavigation} />
                {isAuthenticated && (
                  <NavigationLink item={PROFILE_NAV_ITEM} size="navigation" onNavigate={closeNavigation} />
                )}
              </nav>
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      </div>
      <span id={TOP_NAV_END_ID} hidden />
    </header>
  );
}
