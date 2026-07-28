import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { promoterProgram } from "@/shared/config/promoterProgram";
import { DialogBody, Section, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { ExternalLink } from "@/shared/ui/doodle-icons";
import { formatCadCents } from "@/shared/utils/currency";

interface PromoterTermsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
}

const TERMS_SECTIONS = [
  "eligibility",
  "posters",
  "scans",
  "payments",
  "disputes",
  "conduct",
  "privacy",
  "changes",
] as const;

function formatPayoutDay(day: number, language: string): string {
  if (!language.toLowerCase().startsWith("en")) {
    return String(day);
  }
  const remainder100 = day % 100;
  if (remainder100 >= 11 && remainder100 <= 13) {
    return `${day}th`;
  }
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th";
  return `${day}${suffix}`;
}

export function PromoterTermsDialog({
  open,
  onOpenChange,
  onAccept,
}: PromoterTermsDialogProps) {
  const { t, i18n } = useTranslation();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [hasReachedEnd, setHasReachedEnd] = useState(false);

  const updateScrollGate = () => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    setHasReachedEnd(
      body.scrollHeight - body.scrollTop - body.clientHeight <= 1,
    );
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setHasReachedEnd(false);
    }
    onOpenChange(nextOpen);
  };

  const termsValues = {
    seconds: promoterProgram.landingConfirmationSeconds,
    rate: formatCadCents(promoterProgram.rateCents, i18n.language),
    payoutDay: formatPayoutDay(promoterProgram.payoutDayOfMonth, i18n.language),
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        size="lg"
        scrollable
        data-testid="promoter-terms-dialog"
        onOpenAutoFocus={() => {
          setHasReachedEnd(false);
          window.requestAnimationFrame(() => {
            if (bodyRef.current) {
              bodyRef.current.scrollTop = 0;
            }
            updateScrollGate();
          });
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("posters.terms.title")}</DialogTitle>
          <DialogDescription>
            {t("posters.terms.description", {
              version: promoterProgram.tosVersion,
            })}
          </DialogDescription>
        </DialogHeader>

        <DialogBody
          ref={bodyRef}
          onScroll={updateScrollGate}
          data-testid="promoter-terms-body"
        >
          <Stack gap={4}>
            {TERMS_SECTIONS.map((section) => (
              <Section
                key={section}
                title={t(`posters.terms.${section}.title`)}
                description={t(`posters.terms.${section}.body`, termsValues)}
                variant="surface"
              >
                {section === "disputes" && (
                  <Button asChild variant="secondary" size="sm">
                    <a
                      href={promoterProgram.discordInviteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink />
                      {t("posters.terms.disputes.contact")}
                    </a>
                  </Button>
                )}
              </Section>
            ))}
          </Stack>
        </DialogBody>

        <DialogFooter>
          {!hasReachedEnd && (
            <DialogDescription>
              {t("posters.terms.scrollToAccept")}
            </DialogDescription>
          )}
          <Button
            type="button"
            disabled={!hasReachedEnd}
            onClick={() => {
              onAccept();
              handleOpenChange(false);
            }}
            data-testid="promoter-terms-accept"
          >
            {t("posters.terms.accept")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
