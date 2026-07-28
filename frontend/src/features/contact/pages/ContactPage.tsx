import type { ReactNode } from "react";
import NextLink from "next/link";
import { m } from "framer-motion";
import { EMPTY_FILTER_STATE } from "@/features/search";
import { useSearchStore } from "@/features/search/store/search.store";
import { ROUTES } from "@/shared/constants/routes";
import { EXTERNAL_LINKS } from "@/shared/constants/links";
import { Container, Section, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Link } from "@/shared/ui/link";
import { Separator } from "@/shared/ui/separator";
import { useTranslation } from "react-i18next";
import imgSlefLogo from "@/assets/slef_logo.png";
import imgContactHero from "@/assets/contact_hero.png";

const CornerMask = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <path d="M0 0C0 35.35 28.65 64 64 64H0V0Z" fill="currentColor" />
  </svg>
);

function ContactSearchLink({
  query,
  club = false,
  children,
}: {
  query: string;
  club?: boolean;
  children: ReactNode;
}) {
  const href = club ? ROUTES.ORGANIZATIONS : ROUTES.HOME;

  return (
    <Link
      href={href}
      onClick={() => {
        if (club) return;

        useSearchStore.getState().setFilterState({
          ...EMPTY_FILTER_STATE,
          searchQuery: query,
        });
      }}
    >
      {children}
    </Link>
  );
}

export function ContactPage() {
  const { t } = useTranslation();

  return (
    <Container size="sm">
      <Stack gap={12}>
        <m.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative h-[280px] w-full overflow-hidden rounded-3xl bg-muted sm:h-[360px] md:h-[440px]"
        >
          <img
            src={imgContactHero.src}
            alt={t("contact.heroAlt")}
            className="pointer-events-none h-full w-full select-none object-cover"
          />

          <div className="absolute bottom-0 left-0 z-10 flex select-none flex-col items-start">
            <div className="relative w-fit rounded-tr-[16px] bg-background pb-1 pl-4 pr-5 pt-3 md:rounded-tr-[24px] md:pb-1 md:pl-6 md:pr-8 md:pt-4">
              <CornerMask className="pointer-events-none absolute bottom-full left-0 size-4 text-background md:size-6" />

              <h1 className="font-sans text-3xl font-bold leading-none tracking-tight text-foreground sm:text-5xl">
                {t("contact.hero.line1")}
              </h1>

              <CornerMask className="pointer-events-none absolute bottom-0 left-full size-4 text-background md:size-6" />
            </div>

            <div className="relative w-fit rounded-tr-[16px] bg-background pb-4 pl-4 pr-6 pt-2 md:rounded-tr-[24px] md:pb-6 md:pl-6 md:pr-10 md:pt-3">
              <h1 className="font-sans text-3xl font-bold leading-none tracking-tight text-foreground sm:text-5xl">
                {t("contact.hero.line2")}
              </h1>

              <CornerMask className="pointer-events-none absolute bottom-0 left-full size-4 text-background md:size-6" />
            </div>
          </div>
        </m.div>

        <Card>
          <CardHeader>
            <CardTitle>{t("contact.about.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Stack gap={4}>
              <CardDescription>
                {t("contact.about.welcome")}
                <ContactSearchLink query="hip-hop">
                  {t("contact.about.hipHop")}
                </ContactSearchLink>
                {t("contact.about.remoteCarPrefix")}
                <ContactSearchLink query="remote-controlled">
                  {t("contact.about.remoteCar")}
                </ContactSearchLink>
                , 🍽️{" "}
                <ContactSearchLink query="cooking">
                  {t("contact.about.cooking")}
                </ContactSearchLink>
                {t("contact.about.cookingSuffix")}
                <ContactSearchLink query="curling">
                  {t("contact.about.curling")}
                </ContactSearchLink>
                {t("contact.about.boatCruisePrefix")}
                <ContactSearchLink query="harbour boat">
                  {t("contact.about.boatCruise")}
                </ContactSearchLink>
                {t("contact.about.stratfordPrefix")}
                <ContactSearchLink query="Stratford">
                  {t("contact.about.stratford")}
                </ContactSearchLink>
                {t("contact.about.anniePrefix")}
                <em>{t("contact.about.annie")}</em>, 🎢{" "}
                <ContactSearchLink query="Wonderland">
                  {t("contact.about.wonderland")}
                </ContactSearchLink>
                {t("contact.about.networkingPrefix")}
                <ContactSearchLink query="networking">
                  {t("contact.about.networking")}
                </ContactSearchLink>
                {t("contact.about.builtPrefix")}
                <ContactSearchLink query="August 2025">
                  {t("contact.about.builtDate")}
                </ContactSearchLink>
                {t("contact.about.builtSuffix")}
              </CardDescription>
              <CardDescription>{t("contact.about.signature")}</CardDescription>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Stack gap={4}>
              <CardDescription>
                {t("contact.funding.text")}
                <Link
                  href={EXTERNAL_LINKS.SLEF_INFO}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("contact.funding.slef")}
                </Link>
                {t("contact.funding.wusa")}
              </CardDescription>
              <img
                src={imgSlefLogo.src}
                alt={t("contact.funding.logoAlt")}
                className="h-28 select-none object-contain sm:h-32"
              />
            </Stack>
          </CardContent>
        </Card>

        <Separator />

        <Section description={t("contact.tips.intro")}>
          <Stack gap={6}>
            <Card>
              <CardHeader>
                <CardTitle>{t("contact.tips.networking.title")}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  {t("contact.tips.networking.desc")}
                  <Link
                    href={EXTERNAL_LINKS.ATLASSIAN}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("contact.tips.networking.atlassian")}
                  </Link>
                  ,{" "}
                  <Link
                    href={EXTERNAL_LINKS.BLOOMBERG}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("contact.tips.networking.bloomberg")}
                  </Link>
                  {t("contact.tips.networking.and")}
                  <Link
                    href={EXTERNAL_LINKS.POINT72}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("contact.tips.networking.point72")}
                  </Link>{" "}
                  {t("contact.tips.networking.suffix")}
                </CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("contact.tips.random.title")}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  {t("contact.tips.random.desc")}
                  <ContactSearchLink query="Repair Club" club>
                    {t("contact.tips.random.repair")}
                  </ContactSearchLink>
                  {t("contact.tips.random.repairSuffix")}
                  <ContactSearchLink query="Zumba">
                    {t("contact.tips.random.zumba")}
                  </ContactSearchLink>
                  {t("contact.tips.random.zumbaSuffix")}
                  <ContactSearchLink query="Barbells">
                    {t("contact.tips.random.barbells")}
                  </ContactSearchLink>
                  .
                </CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("contact.tips.search.title")}</CardTitle>
              </CardHeader>
              <CardContent>
                <Stack gap={4}>
                  <CardDescription>
                    {t("contact.tips.search.desc")}
                  </CardDescription>
                  <CardDescription>
                    {t("contact.tips.search.friendsIntro")}
                    <ContactSearchLink query="Pho Night">
                      {t("contact.tips.search.pho")}
                    </ContactSearchLink>
                    ,{" "}
                    <ContactSearchLink query="Campfire Jam">
                      {t("contact.tips.search.campfire")}
                    </ContactSearchLink>
                    {t("contact.tips.search.or")}
                    <ContactSearchLink query="Global Games Night">
                      {t("contact.tips.search.global")}
                    </ContactSearchLink>
                    .
                  </CardDescription>
                </Stack>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("contact.tips.explore.title")}</CardTitle>
              </CardHeader>
              <CardContent>
                <Stack gap={4}>
                  <CardDescription>
                    {t("contact.tips.explore.desc")}
                  </CardDescription>
                  <CardDescription>
                    {t("contact.tips.explore.ps")}
                  </CardDescription>
                </Stack>
              </CardContent>
            </Card>
          </Stack>
        </Section>

        <Stack direction="horizontal" gap={4}>
          <Button asChild variant="secondary">
            <NextLink href={ROUTES.HOME}>
              {t("contact.actions.browse")}
            </NextLink>
          </Button>
          <Button asChild variant="secondary">
            <NextLink href={ROUTES.ORGANIZATIONS}>
              {t("contact.actions.explore")}
            </NextLink>
          </Button>
        </Stack>

        <Separator />

        <Section>
          <Stack gap={1}>
            <CardDescription>{t("contact.footer.about")}</CardDescription>
            <CardDescription>
              {t("contact.footer.copyright", {
                year: new Date().getFullYear(),
              })}
            </CardDescription>
          </Stack>
        </Section>
      </Stack>
    </Container>
  );
}
