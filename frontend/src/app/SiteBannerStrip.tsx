"use client";

import { useLayoutEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { prefetchPublicPage } from "@/app/hooks/useAppNavigation";
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
    };

interface SiteBannerStripProps {
  content: SiteBannerContent;
  ctaHref: string;
}

/** The strip's words in the visitor's language, or null while an announcement's copy is missing. */
function useStripCopy(content: SiteBannerContent): { message: string; ctaLabel: string } | null {
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
    message: content.venue
      ? t("siteBanner.partnerEvent.message", { ...values, venue: content.venue })
      : t("siteBanner.partnerEvent.messageWithoutVenue", values),
    ctaLabel: t("siteBanner.partnerEvent.cta"),
  };
}

/** The persistent announcement strip, with navigation offset by its measured height. */
export function SiteBannerStrip({ content, ctaHref }: SiteBannerStripProps) {
  const router = useRouter();
  const pathname = usePathname();
  const strip = useRef<HTMLDivElement>(null);
  const stripCopy = useStripCopy(content);
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
        <Link
          variant="announcement"
          href={ctaHref}
          prefetch={false}
          onPointerEnter={() => prefetchPublicPage(router, ctaHref)}
          onFocus={() => prefetchPublicPage(router, ctaHref)}
          onTouchStart={() => prefetchPublicPage(router, ctaHref)}
        >
          {copy.ctaLabel}
        </Link>
      </p>
    </div>
  );
}
