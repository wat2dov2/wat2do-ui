"use client";

import { useTranslation } from "react-i18next";
import { useRequestSchool } from "@/app/client-providers";
import { EXTERNAL_LINKS, schoolInstagramHandle } from "@/shared/constants/links";
import { ROUTES } from "@/shared/constants/routes";
import { Container, Stack } from "@/shared/layout";
import { BrandLogo } from "@/shared/ui/brand-logo";
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
 * The close to every scrolling page: the mark beside this school's Instagram
 * handle with its social links beneath, the link columns on the right, and the
 * tagline and fine print below one rule.
 */
export function SiteFooter() {
  const { t } = useTranslation();
  const requestSchool = useRequestSchool();
  const handle = schoolInstagramHandle(requestSchool);
  const socials = [
    { label: "Instagram", href: `https://www.instagram.com/${handle}/` },
    { label: "LinkedIn", href: EXTERNAL_LINKS.LINKEDIN },
  ];

  return (
    <footer data-slot="site-footer" className="mt-16 sm:mt-24">
      <Container size="lg">
        <div className="grid gap-12 py-12 sm:py-16 md:grid-cols-[minmax(0,1fr)_auto] md:gap-24">
          <Stack gap={4}>
            <Stack direction="horizontal" gap={2} align="center">
              <BrandLogo school={requestSchool} size="nav" alt={t("common.logo")} />
              <span className="text-lg font-semibold tracking-tight text-foreground">@{handle}</span>
            </Stack>
            <nav aria-label={t("footer.social")}>
              <Stack direction="horizontal" gap={6} align="center">
                {socials.map((social) => (
                  <Link key={social.label} variant="subtle" href={social.href} target="_blank" rel="noopener noreferrer">
                    {social.label}
                  </Link>
                ))}
              </Stack>
            </nav>
          </Stack>

          <div className="grid grid-cols-2 gap-x-16 gap-y-10 sm:gap-x-24">
            {FOOTER_LINK_GROUPS.map((group) => (
              <nav key={group.labelKey} aria-labelledby={`footer-${group.labelKey}`}>
                <Stack gap={4}>
                  <p id={`footer-${group.labelKey}`} className="text-sm font-semibold text-foreground">
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

        <div className="flex flex-col gap-2 border-t border-border py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p className="text-pretty">{t("footer.tagline")}</p>
          <p className="tabular-nums">
            {t("footer.copyright", { year: new Date().getFullYear() })}
            <span aria-hidden="true"> · </span>
            {t("footer.madeBy")}
          </p>
        </div>
      </Container>
    </footer>
  );
}
