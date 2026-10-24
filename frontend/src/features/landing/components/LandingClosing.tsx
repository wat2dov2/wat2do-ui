"use client";

import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { LandingHeading } from "@/features/landing/components/LandingSection";
import { ROUTES } from "@/shared/constants/routes";
import { Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { ArrowRight } from "lucide-react";

/** The last push back to the feed, restating the problem it ends. */
export function LandingClosing({ schoolName }: { schoolName: string }) {
  const { t } = useTranslation();

  return (
    <Stack as="section" gap={12} align="center" className="border-t border-border pt-20 pb-8 sm:pt-32 sm:pb-16">
      <LandingHeading
        align="center"
        title={t("landing.closing.title")}
        description={t("landing.closing.description", { school: schoolName })}
      />
      <Button size="lg" asChild>
        <NextLink href={ROUTES.EVENTS}>
          {t("landing.closing.action")}
          <ArrowRight aria-hidden="true" />
        </NextLink>
      </Button>
    </Stack>
  );
}
