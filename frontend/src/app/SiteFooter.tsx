"use client";

import Image from "next/image";
import { useTranslation } from "react-i18next";
import imgLogo from "@/assets/38e8096a28295e8dcc0e5020d0a5f3dd85d5f019.png";
import { ROUTES } from "@/shared/constants/routes";
import { Container, Stack } from "@/shared/layout";
import { Link } from "@/shared/ui/link";
import { Separator } from "@/shared/ui/separator";

const FOOTER_COLUMNS = [
  {
    titleKey: "footer.explore",
    links: [
      { labelKey: "navigation.events", href: ROUTES.EVENTS },
      { labelKey: "navigation.clubs", href: ROUTES.CLUBS },
      { labelKey: "navigation.positions", href: ROUTES.POSITIONS },
    ],
  },
  {
    titleKey: "footer.company",
    links: [
      { labelKey: "navigation.about", href: ROUTES.ABOUT },
      { labelKey: "footer.promote", href: ROUTES.PROMOTE },
      { labelKey: "footer.supportLocal", href: ROUTES.SUPPORT_LOCAL },
    ],
  },
] as const;

/** The quiet close to every scrolling page: the brand, where to go next, the fine print. */
export function SiteFooter() {
  const { t } = useTranslation();

  return (
    <footer data-slot="site-footer" className="mt-16 border-t border-border/60 pt-14 pb-8 sm:mt-24">
      <Container size="lg">
        <Stack gap={12}>
          <div className="grid gap-12 sm:grid-cols-[1.6fr_1fr_1fr]">
            <Stack gap={4} align="start">
              <Image alt={t("common.logo")} width={34} height={24} className="h-6 w-[34px] object-contain" src={imgLogo} />
              <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">{t("footer.tagline")}</p>
            </Stack>
            {FOOTER_COLUMNS.map((column) => (
              <Stack key={column.titleKey} as="nav" gap={4} aria-label={t(column.titleKey)}>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-foreground">{t(column.titleKey)}</p>
                <Stack as="ul" gap={3}>
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link variant="subtle" href={link.href}>{t(link.labelKey)}</Link>
                    </li>
                  ))}
                </Stack>
              </Stack>
            ))}
          </div>
          <Separator />
          <Stack direction="horizontal" justify="between" gap={2} wrap className="text-xs text-muted-foreground">
            <span>{t("footer.copyright", { year: new Date().getFullYear() })}</span>
            <span>{t("footer.madeBy")}</span>
          </Stack>
        </Stack>
      </Container>
    </footer>
  );
}
