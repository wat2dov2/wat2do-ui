"use client";

import NextLink from "next/link";
import { Trans, useTranslation } from "react-i18next";
import { LandingMark } from "@/features/landing/components/LandingMarks";
import { LandingHeading } from "@/features/landing/components/LandingSection";
import { ROUTES } from "@/shared/constants/routes";
import { Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { ArrowRight } from "@/shared/ui/doodle-icons";

/** The last push back to the feed, restating the problem it ends. */
export function LandingClosing({ schoolName }: { schoolName: string }) {
  const { t } = useTranslation();

  return (
    <Stack as="section" gap={8} align="center" className="rounded-xl border border-border bg-surface px-6 py-12 sm:py-16">
      <LandingHeading
        eyebrow={t("landing.closing.eyebrow")}
        title={<Trans i18nKey="landing.closing.title" components={{ mark: <LandingMark kind="strike" tone="pink" /> }} />}
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
