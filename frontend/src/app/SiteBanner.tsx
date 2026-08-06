import { headers } from "next/headers";
import Link from "next/link";
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
 * appearing after hydration. `{{school}}` in the message becomes the name of
 * the school whose subdomain the visitor is on.
 *
 * The navigation is fixed to the top, so this is too, and `index.css` offsets
 * the nav and the page below it whenever this strip is present.
 */
export async function SiteBanner() {
  const banner = await getSiteBanner();
  if (!banner) return null;

  const href = resolveCtaHref(banner.cta_href);
  if (!href) return null;

  const requestHeaders = await headers();
  const hostname =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";
  const { school } = getHostnameSchoolStatus(hostname.split(":")[0] ?? "");
  const schoolRecord = await getSchool(school);
  const message = banner.message.replace(
    /\{\{school\}\}/g,
    schoolRecord?.name ?? "your campus",
  );

  return (
    <div
      data-slot="site-banner"
      className="fixed inset-x-0 top-0 z-nav flex h-9 items-center justify-center gap-2 bg-primary px-4 text-xs text-primary-foreground sm:text-sm"
    >
      <span className="min-w-0 truncate">{message}</span>
      <Link
        href={href}
        className="shrink-0 font-semibold underline underline-offset-4"
      >
        {banner.cta_label}
      </Link>
    </div>
  );
}
