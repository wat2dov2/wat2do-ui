"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

import { controlBox } from "@/shared/config/controlBox";
import { Button } from "@/shared/ui/button";
import { X } from "@/shared/ui/doodle-icons";

/**
 * Set when the visitor dismisses the banner, and read on the server so the
 * banner is never sent again while it holds.
 *
 * A cookie rather than localStorage precisely because the server can read it:
 * a dismissal the server cannot see would mean shipping the strip, painting it,
 * and pulling it away once the client caught up - the nav and the whole page
 * jumping up by its height on every single load.
 */
export const SITE_BANNER_DISMISSED_COOKIE = "wat2do_site_banner_dismissed";

interface SiteBannerStripProps {
  messageTranslationKey: string;
  schoolName: string;
  ctaHref: string;
  ctaLabelTranslationKey: string;
}

function rememberDismissal(): void {
  const maxAgeSeconds = controlBox.siteBanner.dismissalDays * 24 * 60 * 60;
  document.cookie = `${SITE_BANNER_DISMISSED_COOKIE}=1; path=/; max-age=${maxAgeSeconds}; samesite=lax`;
}

/**
 * The announcement strip itself.
 *
 * Starts visible on both sides of hydration - the server only renders this at
 * all when the dismissal cookie is absent - so state here covers just the one
 * case the server cannot: the visitor dismissing it in front of us.
 */
export function SiteBannerStrip({
  messageTranslationKey,
  schoolName,
  ctaHref,
  ctaLabelTranslationKey,
}: SiteBannerStripProps) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div
      data-slot="site-banner"
      className="fixed inset-x-0 top-0 z-nav flex h-9 items-center justify-center gap-2 border-b border-border bg-surface px-4 text-xs text-foreground sm:text-sm"
    >
      <span className="min-w-0 max-w-[calc(100dvw_-_10rem)] truncate">
        {t(messageTranslationKey, { school: schoolName })}
      </span>
      <Link
        href={ctaHref}
        className="shrink-0 font-semibold underline underline-offset-4"
      >
        {t(ctaLabelTranslationKey)}
      </Link>
      <Button
        variant="ghost"
        size="icon-sm"
        // Position only: the message stays optically centred in the strip, so
        // the dismiss control is pinned to the edge instead of joining the row.
        className="absolute right-1"
        aria-label={t("navigation.dismissAnnouncement")}
        onClick={() => {
          rememberDismissal();
          setDismissed(true);
        }}
      >
        <X />
      </Button>
    </div>
  );
}
