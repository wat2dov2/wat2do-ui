import NextLink from "next/link";
import { Check, Sparkles, Ticket } from "lucide-react";
import { useTranslation } from "react-i18next";
import { clubPanelTicketSettingsPath } from "@/shared/constants/routes";
import { Button } from "@/shared/ui/button";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { SCROLL_INTO_VIEW_DELAY_MS } from "@/shared/constants/ui";
import { toast } from "@/shared/hooks/use-toast";
import { Section } from "@/shared/layout";
import type { Event, EventFormData } from "@/shared/types";

interface EventSuccessScreenProps {
  onClose: () => void;
  isEditMode: boolean;
  isSubmissionOnly: boolean;
  /** The published event, so its club can turn tickets on for it straight away. */
  createdEventId: number | null;
  formData: EventFormData;
  /** The event as the form last built it; its date and time show on the card. */
  event: Event | null;
}

export function EventSuccessScreen({
  onClose,
  isEditMode,
  isSubmissionOnly,
  createdEventId,
  formData,
  event,
}: EventSuccessScreenProps) {
  const { t, i18n } = useTranslation();

  const handleDone = () => {
    onClose();
    setTimeout(() => {
      toast({
        title: isSubmissionOnly
          ? t("events.submissionReceived")
          : isEditMode
            ? t("events.eventUpdated")
            : t("events.eventCreated"),
        description: isEditMode
          ? t("events.eventUpdatedMessage", { title: formData.title })
          : isSubmissionOnly
            ? t("events.submissionReceivedMessage", { title: formData.title })
            : t("events.eventCreatedMessage", { title: formData.title }),
        variant: "success",
      });
    }, SCROLL_INTO_VIEW_DELAY_MS);
  };

  return (
    <Section variant="surface" data-content-width="sm">
      <div className="flex flex-col items-center gap-y-4 py-4 text-center">
          <div className="relative">
            <div className="size-16 rounded-full bg-success flex items-center justify-center">
              <Check className="size-8 text-primary-foreground" strokeWidth={3} />
            </div>
            <div className="absolute -top-1 -right-1 size-6 bg-warning rounded-full flex items-center justify-center">
              <Sparkles className="size-3 text-primary-foreground" />
            </div>
          </div>

          <h2 className="text-xl font-semibold text-foreground">
            {isSubmissionOnly
              ? t("events.submissionReceived")
              : isEditMode
                ? t("events.eventUpdated")
                : t("events.eventCreated")}
          </h2>
          <p className="text-muted-foreground text-sm">
            "{formData.title}"{" "}
            {isSubmissionOnly
              ? t("events.submissionReceivedDesc")
              : isEditMode
                ? t("events.eventUpdatedDesc")
                : t("events.eventCreatedDesc")}
          </p>

          <div className="w-full rounded-lg p-4 text-left bg-secondary space-y-1">
            <p className="font-medium text-foreground">{formData.title}</p>
            {event ? (
              <>
                <p className="text-sm text-muted-foreground">{event.club}</p>
                <p className="text-sm text-muted-foreground">
                  {formatCardDate(event, formData.timeZone, i18n.language)}
                  {" "}
                  {t("common.at")}
                  {" "}
                  {formatCardTime(event, formData.timeZone, i18n.language)}
                </p>
              </>
            ) : null}
          </div>

          <div className="flex gap-2 w-full">
            <Button variant="outline" onMouseDown={handleDone} className="flex-1">
              {t("common.done")}
            </Button>
            {createdEventId != null && formData.club_id != null && !isEditMode ? (
              <Button asChild className="flex-1">
                <NextLink href={clubPanelTicketSettingsPath(createdEventId)} onClick={onClose}>
                  <Ticket className="size-4" />
                  {t("tickets.setUp")}
                </NextLink>
              </Button>
            ) : null}
          </div>
      </div>
    </Section>
  );
}
