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
import { eventPagePath } from "@/features/events/lib/eventUrls";
import { Separator } from "@/shared/ui/separator";
import { useTranslation } from "react-i18next";
import imgSlefLogo from "@/assets/slef_logo.png";
import imgContactHero from "@/assets/contact_hero.png";
import { ContactForm } from "@/features/contact/components/ContactForm";

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

/**
 * Link to the event being described. These are specific past events from the
 * founder's own story, so they point at the event page rather than a search
 * that may stop matching. Anything with no event of its own stays plain text.
 */
function ContactEventLink({
  eventId,
  children,
}: {
  eventId: number;
  children: ReactNode;
}) {
  return <Link href={eventPagePath(eventId)}>{children}</Link>;
}

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

        <ContactForm />

        <Card>
          <CardHeader>
            <CardTitle>{t("contact.about.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Stack gap={4}>
              <CardDescription>
                {t("contact.about.welcome")}
                <ContactEventLink eventId={13576}>
                  {t("contact.about.hipHop")}
                </ContactEventLink>
                {t("contact.about.remoteCarPrefix")}
                {t("contact.about.remoteCar")}
                , 🍽️{" "}
                <ContactEventLink eventId={11159}>
                  {t("contact.about.cooking")}
                </ContactEventLink>
                {t("contact.about.cookingSuffix")}
                <ContactEventLink eventId={12431}>
                  {t("contact.about.curling")}
                </ContactEventLink>
                {t("contact.about.boatCruisePrefix")}
                {t("contact.about.boatCruise")}
                {t("contact.about.stratfordPrefix")}
                <ContactEventLink eventId={11678}>
                  {t("contact.about.stratford")}
                </ContactEventLink>
                {t("contact.about.anniePrefix")}
                <em>{t("contact.about.annie")}</em>, 🎢{" "}
                <ContactEventLink eventId={17881}>
                  {t("contact.about.wonderland")}
                </ContactEventLink>
                {t("contact.about.networkingPrefix")}
                <ContactEventLink eventId={10866}>
                  {t("contact.about.networking")}
                </ContactEventLink>
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
                  <ContactEventLink eventId={13204}>
                    {t("contact.tips.random.zumba")}
                  </ContactEventLink>
                  {t("contact.tips.random.zumbaSuffix")}
                  <ContactEventLink eventId={11009}>
                    {t("contact.tips.random.barbells")}
                  </ContactEventLink>
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
                    <ContactEventLink eventId={11216}>
                      {t("contact.tips.search.pho")}
                    </ContactEventLink>
                    ,{" "}
                    <ContactEventLink eventId={11590}>
                      {t("contact.tips.search.campfire")}
                    </ContactEventLink>
                    {t("contact.tips.search.or")}
                    <ContactEventLink eventId={11535}>
                      {t("contact.tips.search.global")}
                    </ContactEventLink>
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
