import { cookies, headers } from "next/headers";
import {
  SITE_BANNER_DISMISSED_COOKIE,
  SiteBannerStrip,
} from "@/app/SiteBannerStrip";
import { getSchool } from "@/shared/api/schools.server";
import { getSiteBanner } from "@/shared/api/siteBanner.server";
import { getHostnameSchoolStatus } from "@/shared/constants/schools";
import { sanitizeHref } from "@/shared/utils/url";

/**
 * The CTA is usually a page on this site, so a bare path is the common case.
 * `sanitizeHref` exists for links that arrive from elsewhere and deliberately
 * rejects anything without a protocol, so a same-site path is checked here and
 * everything else still goes through it.
 */
function resolveCtaHref(href: string): string {
  const trimmed = href.trim();
  // A single leading slash only: "//host" is protocol-relative and off-site.
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  return sanitizeHref(trimmed);
}

/**
 * The site-wide announcement strip, pinned above the navigation on every page.
 *
 * A server component, so the copy is part of the first paint rather than
 * appearing after hydration, and so a visitor who has already dismissed it is
 * simply never sent it. The database stores stable translation keys while the
 * visitor's active locale owns the rendered copy.
 *
 * The navigation is fixed to the top, so this is too, and `index.css` offsets
 * the nav and the page below it whenever this strip is present.
 */
export async function SiteBanner() {
  const banner = await getSiteBanner();
  if (!banner) return null;

  const href = resolveCtaHref(banner.cta_href);
  if (!href) return null;

  const cookieStore = await cookies();
  if (cookieStore.has(SITE_BANNER_DISMISSED_COOKIE)) return null;

  const requestHeaders = await headers();
  const hostname =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";
  const { school } = getHostnameSchoolStatus(hostname.split(":")[0] ?? "");
  const schoolRecord = await getSchool(school);

  return (
    <SiteBannerStrip
      messageTranslationKey={banner.message_translation_key}
      schoolName={schoolRecord?.name ?? school}
      ctaHref={href}
      ctaLabelTranslationKey={banner.cta_label_translation_key}
    />
  );
}
