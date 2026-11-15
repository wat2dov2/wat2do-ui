"use client";

import type { ReactNode } from "react";
import { Trans } from "react-i18next";

import { useLegalTranslation } from "@/features/legal/hooks/useLegalTranslation";
import { LEGAL_ENGLISH } from "@/features/legal/lib/translations";
import type { LegalValues } from "@/features/legal/lib/values";
import { ROUTES } from "@/shared/constants/routes";
import { Container, PageHeader, Section, Stack } from "@/shared/layout";
import { Link } from "@/shared/ui/link";

/** A defined term and what it means. */
interface DefinitionCopy {
  term: string;
  text: string;
}

/**
 * One legal document's English copy, which also sets its shape: inside a
 * section, a string is a paragraph and an object is a list, of plain items or
 * of defined terms, in the order the keys appear.
 */
interface LegalDocumentCopy {
  title: string;
  intro: string;
  summary: Record<string, string>;
  sections: Record<string, Record<string, string | Record<string, string> | Record<string, DefinitionCopy>>>;
}

const DOCUMENTS = {
  clubPayoutTerms: LEGAL_ENGLISH.clubPayoutTerms,
  dataPolicy: LEGAL_ENGLISH.dataPolicy,
} satisfies Record<string, LegalDocumentCopy>;

export type LegalDocumentName = keyof typeof DOCUMENTS;

interface LegalDocumentProps {
  name: LegalDocumentName;
  values: LegalValues;
}

/**
 * A legal page: its title and effective date, the short version, a table of
 * contents, then each section. The copy comes from the legal locales, so every
 * document reads the same way in every language.
 */
export function LegalDocument({ name, values }: LegalDocumentProps) {
  const { t, i18n } = useLegalTranslation();
  const copy: LegalDocumentCopy = DOCUMENTS[name];
  const base = `legal.${name}`;
  const sections = Object.entries(copy.sections);
  const links = {
    email: <Link href={`mailto:${values.email}`} />,
    dataPolicy: <Link href={ROUTES.DATA_POLICY} />,
    payoutTerms: <Link href={ROUTES.CLUB_PAYOUT_TERMS} />,
  };
  const text = (key: string) => (
    <Trans t={t} i18nKey={`${base}.${key}`} values={values} components={links} />
  );

  return (
    <Container size="sm">
      <Stack gap={8}>
        <PageHeader
          title={t(`${base}.title`)}
          description={t("legal.common.effective", { date: values.effectiveDate })}
        />

        <Stack gap={3}>
          <LegalParagraph>{text("intro")}</LegalParagraph>
          {i18n.language === "en" ? null : (
            <LegalParagraph>{t("legal.common.translationNotice")}</LegalParagraph>
          )}
        </Stack>

        <Section variant="surface" title={t("legal.common.summary")}>
          <LegalList>
            {Object.keys(copy.summary).map((key) => (
              <li key={key}>{text(`summary.${key}`)}</li>
            ))}
          </LegalList>
        </Section>

        <nav aria-label={t("legal.common.contents")}>
          <Section variant="divided" title={t("legal.common.contents")}>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
              {sections.map(([id]) => (
                <li key={id}>
                  <Link variant="muted" href={`#${id}`}>
                    {t(`${base}.sections.${id}.title`)}
                  </Link>
                </li>
              ))}
            </ol>
          </Section>
        </nav>

        {sections.map(([id, section]) => (
          // The fixed top navigation would cover a heading its contents link scrolls to.
          <Section key={id} id={id} title={t(`${base}.sections.${id}.title`)} className="scroll-mt-16">
            <Stack gap={3}>
              {Object.entries(section).map(([key, block]) => {
                const path = `sections.${id}.${key}`;
                if (key === "title") {
                  return null;
                }
                if (typeof block === "string") {
                  return <LegalParagraph key={key}>{text(path)}</LegalParagraph>;
                }
                return (
                  <LegalList key={key}>
                    {Object.entries(block).map(([item, value]) => (
                      <li key={item}>
                        {typeof value === "string" ? (
                          text(`${path}.${item}`)
                        ) : (
                          <>
                            <span className="font-medium text-foreground">
                              {text(`${path}.${item}.term`)}
                            </span>{" "}
                            {text(`${path}.${item}.text`)}
                          </>
                        )}
                      </li>
                    ))}
                  </LegalList>
                );
              })}
            </Stack>
          </Section>
        ))}
      </Stack>
    </Container>
  );
}

function LegalParagraph({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-pretty text-muted-foreground">{children}</p>;
}

function LegalList({ children }: { children: ReactNode }) {
  return (
    <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
      {children}
    </ul>
  );
}
