"use client";

import Image from "next/image";
import { useTranslation } from "react-i18next";
import imgLogo from "@/assets/38e8096a28295e8dcc0e5020d0a5f3dd85d5f019.png";
import { ROUTES } from "@/shared/constants/routes";
import { Container, Stack } from "@/shared/layout";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { EventImageCutout, useEventImageCutouts } from "@/shared/ui/event-image-cutout";
import { Link } from "@/shared/ui/link";

const FOOTER_LINK_GROUPS = [
  {
    labelKey: "footer.explore",
    links: [
      { labelKey: "navigation.events", href: ROUTES.EVENTS },
      { labelKey: "navigation.clubs", href: ROUTES.CLUBS },
      { labelKey: "navigation.positions", href: ROUTES.POSITIONS },
    ],
  },
  {
    labelKey: "footer.company",
    links: [
      { labelKey: "navigation.about", href: ROUTES.ABOUT },
      { labelKey: "footer.promote", href: ROUTES.PROMOTE },
      { labelKey: "footer.supportLocal", href: ROUTES.SUPPORT_LOCAL },
    ],
  },
] as const;

/**
 * The close to every scrolling page, cut from the same notched face as event
 * cards: the mark sits in the top-left notch, the fine print in the
 * bottom-right one, and the tagline carries the voice in between.
 */
export function SiteFooter() {
  const { t } = useTranslation();
  const { surfaceRef, registerCorner, cutouts, box } = useEventImageCutouts();

  return (
    <footer data-slot="site-footer" className="mt-16 sm:mt-24">
      <Container size="lg">
        <div ref={surfaceRef} className="relative overflow-hidden rounded-3xl">
          <EventImageCutout
            backgroundColor="var(--muted)"
            cutouts={cutouts}
            width={box.width}
            height={box.height}
            className="absolute inset-0"
          />
          <BadgeMask variant="top-left" cutout containerRef={registerCorner("top-left")}>
            <div className="px-3 py-2">
              <Image alt={t("common.logo")} width={34} height={24} className="h-6 w-[34px] select-none object-contain" src={imgLogo} />
            </div>
          </BadgeMask>

          {/* Padding clears both notches so content never runs underneath them. */}
          <Stack gap={8} className="relative px-6 pt-20 pb-20 sm:px-10 sm:pt-24">
            <p className="max-w-[20ch] text-[clamp(1.75rem,3.6vw,2.75rem)] font-medium leading-[1.05] tracking-[-0.03em] text-balance text-foreground">
              {t("footer.tagline")}
            </p>
            <Stack direction="horizontal" gap={8} wrap>
              {FOOTER_LINK_GROUPS.map((group) => (
                <nav key={group.labelKey} aria-label={t(group.labelKey)}>
                  <ul className="flex flex-wrap gap-x-6 gap-y-3">
                    {group.links.map((link) => (
                      <li key={link.href}>
                        <Link variant="subtle" href={link.href}>{t(link.labelKey)}</Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              ))}
            </Stack>
          </Stack>

          <BadgeMask variant="bottom-right" cutout containerRef={registerCorner("bottom-right")}>
            <p className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
              {t("footer.copyright", { year: new Date().getFullYear() })}
              <span aria-hidden="true"> · </span>
              {t("footer.madeBy")}
            </p>
          </BadgeMask>
        </div>
      </Container>
    </footer>
  );
}
