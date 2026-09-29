"use client";

import { useLayoutEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { prefetchPublicPage } from "@/app/hooks/useAppNavigation";
import { Link } from "@/shared/ui/link";

interface SiteBannerStripProps {
  messageTranslationKey: string;
  schoolCity?: string | null;
  ctaHref: string;
  ctaLabelTranslationKey: string;
}

/** The persistent announcement strip, with navigation offset by its measured height. */
export function SiteBannerStrip({
  messageTranslationKey,
  schoolCity,
  ctaHref,
  ctaLabelTranslationKey,
}: SiteBannerStripProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const strip = useRef<HTMLDivElement>(null);
  // A stale banner snapshot must not expose untranslated internal keys.
  const isVisible = i18n.exists(messageTranslationKey) && i18n.exists(ctaLabelTranslationKey);

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

  if (!isVisible) return null;

  return (
    <div
      ref={strip}
      data-slot="site-banner"
      className="fixed inset-x-0 top-0 z-nav border-b border-border bg-surface px-4 py-2 text-center text-xs leading-relaxed text-foreground sm:text-sm"
    >
      <p>
        {t(messageTranslationKey, { city: schoolCity?.trim() || t("siteBanner.localArea") })}{" "}
        <Link
          variant="announcement"
          href={ctaHref}
          prefetch={false}
          onPointerEnter={() => prefetchPublicPage(router, ctaHref)}
          onFocus={() => prefetchPublicPage(router, ctaHref)}
          onTouchStart={() => prefetchPublicPage(router, ctaHref)}
        >
          {t(ctaLabelTranslationKey)}
        </Link>
      </p>
    </div>
  );
}
