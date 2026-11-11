"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { MapPinOff } from "lucide-react";
import { ROUTES } from "@/shared/constants/routes";
import { EmptyState } from "@/shared/feedback";
import { Container, PageFrame, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";

export default function NotFound() {
  const { t } = useTranslation();

  return (
    <PageFrame>
      <Container size="sm">
        <EmptyState
          icon={<MapPinOff />}
          title={t("notFound.title")}
          description={t("notFound.description")}
          action={
            <Stack direction="horizontal" justify="center" gap={2} wrap>
              <Button asChild>
                <Link href={ROUTES.EVENTS}>{t("notFound.browseEvents")}</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={ROUTES.CLUBS}>{t("notFound.browseClubs")}</Link>
              </Button>
            </Stack>
          }
        />
      </Container>
    </PageFrame>
  );
}
