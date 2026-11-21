import { SiteBannerStrip } from "@/app/SiteBannerStrip";
import { getSchoolPartnerEventBanner } from "@/features/events/api/eventFeed.server";
import type { SchoolSummary } from "@/shared/api/schools.api";
import { getSiteBanner } from "@/shared/api/siteBanner.server";
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
 * While a partner business's event at this school is on or coming up
 * (`backend/controlbox/partners.json`), the strip promotes it instead, linking
 * to the partner's Instagram post about it.
 *
 * A server component, so the copy is part of the first paint rather than
 * appearing after hydration. The database stores stable translation keys while
 * the visitor's active locale owns the rendered copy.
 *
 * The navigation is fixed to the top, so this is too, and `index.css` offsets
 * the nav and the page below it whenever this strip is present.
 */
export async function SiteBanner({ school }: { school?: SchoolSummary }) {
  const partnerEvent = school ? await getSchoolPartnerEventBanner(school.slug) : null;
  if (school && partnerEvent) {
    return (
      <SiteBannerStrip
        content={{
          kind: "partnerEvent",
          partnerName: partnerEvent.partnerName,
          discountPercent: partnerEvent.discountPercent,
          discountCode: partnerEvent.discountCode,
          venue: partnerEvent.venue,
          occurrence: partnerEvent.occurrence,
          timeZone: school.timezone,
          linksTo: partnerEvent.link.kind,
        }}
        ctaHref={partnerEvent.link.href}
      />
    );
  }

  const banner = await getSiteBanner();
  if (!banner) return null;

  const href = resolveCtaHref(banner.cta_href);
  if (!href) return null;

  return (
    <SiteBannerStrip
      content={{
        kind: "announcement",
        messageTranslationKey: banner.message_translation_key,
        ctaLabelTranslationKey: banner.cta_label_translation_key,
        schoolName: school?.name,
      }}
      ctaHref={href}
    />
  );
}
