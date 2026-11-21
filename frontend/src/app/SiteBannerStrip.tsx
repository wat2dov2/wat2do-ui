"use client";

import { useLayoutEffect, useRef, type ReactElement, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Trans, useTranslation } from "react-i18next";

import { prefetchPublicPage } from "@/app/hooks/useAppNavigation";
import type { PartnerEventLink } from "@/features/events/lib/partnerEventBanner";
import { ROUTES } from "@/shared/constants/routes";
import { Link } from "@/shared/ui/link";
import { formatOccurrence, type Occurrence } from "@/shared/utils/date";

/** The strip shows on the browse pages only, never over a detail page, a form or a chromeless flow. */
const BANNER_ROUTES = new Set<string>([ROUTES.EVENTS, ROUTES.CLUBS, ROUTES.POSITIONS]);

/** What the strip says: the site-wide announcement, or a partner business's next event at this school. */
export type SiteBannerContent =
  | {
      kind: "announcement";
      messageTranslationKey: string;
      ctaLabelTranslationKey: string;
      schoolName?: string | null;
    }
  | {
      kind: "partnerEvent";
      partnerName: string;
      discountPercent: number;
      discountCode: string;
      /** The venue's own name, or null when the event names none to show. */
      venue: string | null;
      occurrence: Occurrence;
      /** The school's clock, which the rest of its site shows event times in. */
      timeZone: string;
      /** What the partner's name and the call to action open. */
      linksTo: PartnerEventLink["kind"];
    };

interface SiteBannerStripProps {
  content: SiteBannerContent;
  ctaHref: string;
}

/**
 * The strip's words in the visitor's language, with a partner's name inside
 * `nameLink`, or null while an announcement's copy is missing.
 */
function useStripCopy(
  content: SiteBannerContent,
  nameLink: ReactElement,
): { message: ReactNode; ctaLabel: string } | null {
  const { t, i18n } = useTranslation();
  if (content.kind === "announcement") {
    // A stale banner snapshot must not expose untranslated internal keys.
    if (!i18n.exists(content.messageTranslationKey) || !i18n.exists(content.ctaLabelTranslationKey)) {
      return null;
    }
    return {
      message: t(content.messageTranslationKey, {
        schoolName: content.schoolName?.trim() || t("siteBanner.localUniversity"),
      }),
      ctaLabel: t(content.ctaLabelTranslationKey),
    };
  }
  const values = {
    partner: content.partnerName,
    when: formatOccurrence(content.occurrence, content.timeZone, i18n.language),
    discount: new Intl.NumberFormat(i18n.language, { style: "percent" }).format(
      content.discountPercent / 100,
    ),
    code: content.discountCode,
  };
  return {
    // The values are escaped while Trans reads the copy's tags, so a venue
    // taken from a post can never add markup, and unescaped again for display.
    message: (
      <Trans
        t={t}
        i18nKey={content.venue ? "siteBanner.partnerEvent.message" : "siteBanner.partnerEvent.messageWithoutVenue"}
        values={content.venue ? { ...values, venue: content.venue } : values}
        tOptions={{ interpolation: { escapeValue: true } }}
        shouldUnescape
        components={{ partnerLink: nameLink }}
      />
    ),
    ctaLabel:
      content.linksTo === "instagramPost"
        ? t("siteBanner.partnerEvent.cta")
        : t("siteBanner.partnerEvent.ctaWithoutPost"),
  };
}

interface StripLinkProps {
  href: string;
  /** A post on Instagram, which opens in a new tab like every link off the site. */
  offSite: boolean;
  children?: ReactNode;
}

/** One of the strip's links; a page here is warmed as soon as the visitor reaches for it. */
function StripLink({ href, offSite, children }: StripLinkProps) {
  const router = useRouter();
  const warm = () => prefetchPublicPage(router, href);
  return (
    <Link
      variant="announcement"
      href={href}
      prefetch={false}
      {...(offSite
        ? { target: "_blank", rel: "noopener noreferrer" }
        : { onPointerEnter: warm, onFocus: warm, onTouchStart: warm })}
    >
      {children}
    </Link>
  );
}

/** The persistent announcement strip, with navigation offset by its measured height. */
export function SiteBannerStrip({ content, ctaHref }: SiteBannerStripProps) {
  const pathname = usePathname();
  const strip = useRef<HTMLDivElement>(null);
  const offSite = content.kind === "partnerEvent" && content.linksTo === "instagramPost";
  const stripCopy = useStripCopy(content, <StripLink href={ctaHref} offSite={offSite} />);
  const copy = BANNER_ROUTES.has(pathname.replace(/\/$/, "") || "/") ? stripCopy : null;
  const isVisible = copy !== null;

  useLayoutEffect(() => {
    if (!isVisible || !strip.current) return;
    const element = strip.current;
    const root = document.documentElement;
    const measure = () => {
      root.style.setProperty(
        "--site-banner-height",
        `${Math.ceil(element.getBoundingClientRect().height)}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--site-banner-height");
    };
  }, [isVisible]);

  if (!copy) return null;

  return (
    <div
      ref={strip}
      data-slot="site-banner"
      className="fixed inset-x-0 top-0 z-nav border-b border-border bg-surface px-4 py-2 text-center text-xs leading-relaxed text-foreground sm:text-sm"
    >
      <p>
        {copy.message}{" "}
        <StripLink href={ctaHref} offSite={offSite}>
          {copy.ctaLabel}
        </StripLink>
      </p>
    </div>
  );
}
