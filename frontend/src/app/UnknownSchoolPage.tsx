import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "@/shared/ui/doodle-icons";
import { Container, PageFrame, PageHeader, Stack } from "@/shared/layout";

interface UnknownSchoolPageProps {
  requestedSchool: string;
}

function getHomeUrl(): string {
  if (typeof window === "undefined") return "/";
  if (window.location.hostname.endsWith("wat2do.io")) {
    return `${window.location.protocol}//wat2do.io/`;
  }
  return "/";
}

export function UnknownSchoolPage({ requestedSchool }: UnknownSchoolPageProps) {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = t("schools.unknownSubdomainDocumentTitle");
  }, [t]);

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <PageFrame>
        <Container size="lg">
          <Stack gap={12}>
            <PageHeader
              back={{
                label: t("schools.unknownSubdomainAction"),
                onClick: () => window.location.assign(getHomeUrl()),
              }}
            />
            <Stack as="section" align="center" gap={5} className="text-center">
              <Search className="w-44 h-44 sm:w-56 sm:h-56 text-primary" aria-hidden="true" />
              <p className="text-sm font-semibold tracking-[0.2em] text-muted-foreground">
                {t("schools.unknownSubdomainEyebrow")}
              </p>
              <h1 className="text-4xl sm:text-6xl font-semibold tracking-normal leading-tight">
                {t("schools.unknownSubdomainTitle")}
              </h1>
              <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl">
                {t("schools.unknownSubdomainDescription", { school: requestedSchool })}
              </p>
            </Stack>
          </Stack>
        </Container>
      </PageFrame>
    </main>
  );
}
