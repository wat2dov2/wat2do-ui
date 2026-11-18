"use client";

import Image from "next/image";
import NextLink from "next/link";
import { ROUTES } from "@/shared/constants/routes";
import { EXTERNAL_LINKS } from "@/shared/constants/links";
import { Container, FormGrid, Section, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Link } from "@/shared/ui/link";
import { useTranslation } from "react-i18next";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import imgSlefLogo from "@/assets/slef_logo.png";
import { SchoolPhotoCarousel } from "@/features/contact/components/SchoolPhotoCarousel";
import { ContactForm } from "@/features/contact/components/ContactForm";

const FEATURES = ["schools", "discover", "positions", "clubs", "submit", "account"] as const;

export function AboutPage({ isLoading = false }: { isLoading?: boolean }) {
  const { t } = useTranslation();
  const { schools } = useSchoolDirectory();

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
              <CardDescription>{t("contact.about.summary")}</CardDescription>
              <CardDescription>
                {t("contact.about.origin", { count: schools.length })}
              </CardDescription>
              <CardDescription>{t("contact.about.belief")}</CardDescription>
              <CardDescription>{t("contact.about.problem")}</CardDescription>
              <CardDescription>{t("contact.about.signature")}</CardDescription>
            </Stack>
          </CardContent>
        </Card>

        <Section title={t("contact.features.title")}>
          <FormGrid columns={2}>
            {FEATURES.map((feature) => (
              <Card key={feature}>
                <CardHeader>
                  <CardTitle>{t(`contact.features.${feature}.title`)}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>
                    {t(`contact.features.${feature}.desc`)}
                  </CardDescription>
                </CardContent>
              </Card>
            ))}
          </FormGrid>
        </Section>

        <ContactForm />

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
      </Stack>
    </Container>
  );
}
