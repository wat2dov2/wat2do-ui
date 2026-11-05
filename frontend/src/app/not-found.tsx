"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { MapPinOff } from "lucide-react";
import { ROUTES } from "@/shared/constants/routes";
import { Container, PageFrame, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";

export default function NotFound() {
  const { t } = useTranslation();

  return (
    <PageFrame>
      <Container size="lg">
        <Stack as="section" align="center" gap={5} className="py-16 text-center sm:py-24">
          <MapPinOff className="h-24 w-24 text-primary sm:h-32 sm:w-32" aria-hidden="true" />
          <p className="text-sm font-semibold tracking-[0.2em] text-muted-foreground">
            {t("notFound.eyebrow")}
          </p>
          <h1 className="text-4xl font-semibold leading-tight tracking-normal sm:text-6xl">
            {t("notFound.title")}
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground sm:text-xl">
            {t("notFound.description")}
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Button asChild>
              <Link href={ROUTES.HOME}>{t("notFound.browseEvents")}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={ROUTES.CLUBS}>{t("notFound.browseClubs")}</Link>
            </Button>
          </div>
        </Stack>
      </Container>
    </PageFrame>
  );
}
