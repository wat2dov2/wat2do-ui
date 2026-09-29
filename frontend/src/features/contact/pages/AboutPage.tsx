"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import NextLink from "next/link";
import { EMPTY_FILTER_STATE } from "@/features/search/api/filterService";
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
import { SchoolPhotoCarousel } from "@/features/contact/components/SchoolPhotoCarousel";
import { ContactForm } from "@/features/contact/components/ContactForm";

/**
 * Link to the event being described. These are specific past events from the
 * founder's own story, so they point at the event page rather than a search
 * that may stop matching. Anything with no event of its own stays plain text.
 */
function AboutEventLink({
  eventId,
  children,
}: {
  eventId: number;
  children: ReactNode;
}) {
  return <Link href={eventPagePath(eventId)}>{children}</Link>;
}

function AboutSearchLink({
  query,
  club = false,
  children,
}: {
  query: string;
  club?: boolean;
  children: ReactNode;
}) {
  const href = club ? ROUTES.CLUBS : ROUTES.EVENTS;

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

export function AboutPage({ isLoading = false }: { isLoading?: boolean }) {
  const { t } = useTranslation();

  return (
    <Container size="sm">
      <Stack gap={12}>
        <SchoolPhotoCarousel isLoading={isLoading} />

        <Card>
          <CardHeader>
            <CardTitle>{t("contact.about.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Stack gap={4}>
              <CardDescription>{t("contact.about.origin")}</CardDescription>
              <CardDescription>{t("contact.about.belief")}</CardDescription>
              <CardDescription>{t("contact.about.scale")}</CardDescription>
              <CardDescription>{t("contact.about.mission")}</CardDescription>
              <CardDescription>{t("contact.about.signature")}</CardDescription>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("contact.help.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Stack gap={4}>
              <CardDescription>{t("contact.help.description")}</CardDescription>
              <Stack direction="horizontal">
                <Button asChild>
                  <NextLink href={ROUTES.PROMOTE}>
                    {t("contact.help.action")}
                  </NextLink>
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <ContactForm />

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
              <Image
                src={imgSlefLogo}
                alt={t("contact.funding.logoAlt")}
                width={228}
                height={128}
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
                  <AboutSearchLink query="Repair Club" club>
                    {t("contact.tips.random.repair")}
                  </AboutSearchLink>
                  {t("contact.tips.random.repairSuffix")}
                  <AboutEventLink eventId={13204}>
                    {t("contact.tips.random.zumba")}
                  </AboutEventLink>
                  {t("contact.tips.random.zumbaSuffix")}
                  <AboutEventLink eventId={11009}>
                    {t("contact.tips.random.barbells")}
                  </AboutEventLink>
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
                    <AboutEventLink eventId={11216}>
                      {t("contact.tips.search.pho")}
                    </AboutEventLink>
                    ,{" "}
                    <AboutEventLink eventId={11590}>
                      {t("contact.tips.search.campfire")}
                    </AboutEventLink>
                    {t("contact.tips.search.or")}
                    <AboutEventLink eventId={11535}>
                      {t("contact.tips.search.global")}
                    </AboutEventLink>
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
          <Button asChild variant="outline">
            <NextLink href={ROUTES.EVENTS}>
              {t("contact.actions.browse")}
            </NextLink>
          </Button>
          <Button asChild variant="outline">
            <NextLink href={ROUTES.CLUBS}>
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
