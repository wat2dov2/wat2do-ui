"use client";

import Image from "next/image";
import { useTranslation } from "react-i18next";
import imgLogo from "@/assets/38e8096a28295e8dcc0e5020d0a5f3dd85d5f019.png";
import { ROUTES } from "@/shared/constants/routes";
import { Container, Stack } from "@/shared/layout";
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
 * The close to every scrolling page: the mark and tagline carry the voice on the
 * left, the link groups sit in labelled columns on the right, and the fine print
 * closes the card below a divider.
 */
export function SiteFooter() {
  const { t } = useTranslation();

  return (
    <footer data-slot="site-footer" className="mt-16 sm:mt-24">
      <Container size="lg">
        <div className="rounded-3xl bg-muted px-6 py-8 sm:px-10 sm:py-10">
          <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
            <Stack gap={5} className="max-w-md">
              <Image
                alt={t("common.logo")}
                width={34}
                height={24}
                className="h-6 w-[34px] select-none object-contain"
                src={imgLogo}
              />
              <p className="text-[clamp(1.5rem,3vw,2.25rem)] font-medium leading-[1.1] tracking-[-0.03em] text-balance text-foreground">
                {t("footer.tagline")}
              </p>
            </Stack>

            <div className="grid grid-cols-2 gap-x-12 gap-y-8 sm:gap-x-16">
              {FOOTER_LINK_GROUPS.map((group) => (
                <nav key={group.labelKey} aria-labelledby={`footer-${group.labelKey}`}>
                  <Stack gap={3}>
                    <p id={`footer-${group.labelKey}`} className="text-sm font-medium text-foreground">
                      {t(group.labelKey)}
                    </p>
                    <Stack as="ul" gap={3}>
                      {group.links.map((link) => (
                        <li key={link.href}>
                          <Link variant="subtle" href={link.href}>
                            {t(link.labelKey)}
                          </Link>
                        </li>
                      ))}
                    </Stack>
                  </Stack>
                </nav>
              ))}
            </div>
          </div>

          <p className="mt-10 border-t border-border pt-6 text-xs tabular-nums text-muted-foreground">
            {t("footer.copyright", { year: new Date().getFullYear() })}
            <span aria-hidden="true"> · </span>
            {t("footer.madeBy")}
          </p>
        </div>
      </Container>
    </footer>
  );
}
