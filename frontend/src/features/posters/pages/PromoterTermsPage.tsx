import { useTranslation } from "react-i18next";

import { promoterProgram } from "@/shared/config/promoterProgram";
import { ROUTES } from "@/shared/constants/routes";
import { Container, PageHeader, Section, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { ArrowLeft } from "@/shared/ui/doodle-icons";
import { Link } from "@/shared/ui/link";

export function PromoterTermsPage() {
  const { t } = useTranslation();
  const sections = [
    "eligibility",
    "posters",
    "visitors",
    "payments",
    "conduct",
    "privacy",
    "changes",
  ] as const;

  return (
    <main className="min-h-screen py-6 sm:py-10" data-testid="promoter-terms-page">
      <Container size="md">
        <Stack gap={8}>
          <PageHeader
            title={t("posters.terms.title")}
            description={t("posters.terms.description", {
              version: promoterProgram.tosVersion,
            })}
            actions={
              <Button asChild variant="secondary">
                <Link href={ROUTES.PROMOTE}>
                  <ArrowLeft />
                  {t("posters.terms.back")}
                </Link>
              </Button>
            }
          />
          {sections.map((section) => (
            <Section
              key={section}
              title={t(`posters.terms.${section}.title`)}
              variant="surface"
            >
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t(`posters.terms.${section}.body`)}
              </p>
            </Section>
          ))}
        </Stack>
      </Container>
    </main>
  );
}
