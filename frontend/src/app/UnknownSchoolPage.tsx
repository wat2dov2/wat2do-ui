import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Search } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";

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
    <main className="min-h-dvh bg-background text-foreground flex items-center justify-center p-6">
      <section className="w-full max-w-3xl text-center flex flex-col items-center">
        <Search className="w-44 h-44 sm:w-56 sm:h-56 text-primary mb-8" aria-hidden="true" />
        <p className="text-sm font-semibold tracking-[0.2em] text-muted-foreground mb-4">
          {t("schools.unknownSubdomainEyebrow")}
        </p>
        <h1 className="text-4xl sm:text-6xl font-semibold tracking-normal leading-tight mb-5">
          {t("schools.unknownSubdomainTitle")}
        </h1>
        <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mb-8">
          {t("schools.unknownSubdomainDescription", { school: requestedSchool })}
        </p>
        <Button
          type="button"
          size="lg"
          onMouseDown={() => {
            window.location.assign(getHomeUrl());
          }}
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
          {t("schools.unknownSubdomainAction")}
        </Button>
      </section>
    </main>
  );
}
