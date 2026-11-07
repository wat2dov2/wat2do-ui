import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { EmptyState } from "@/shared/feedback";
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
        <Container size="sm">
          <Stack gap={6}>
            <PageHeader
              back={{
                label: t("schools.unknownSubdomainAction"),
                onClick: () => window.location.assign(getHomeUrl()),
              }}
            />
            <EmptyState
              icon={<Search />}
              title={t("schools.unknownSubdomainTitle")}
              description={t("schools.unknownSubdomainDescription", { school: requestedSchool })}
            />
          </Stack>
        </Container>
      </PageFrame>
    </main>
  );
}
