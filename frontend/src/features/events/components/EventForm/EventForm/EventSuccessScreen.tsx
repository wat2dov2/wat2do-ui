import { useMemo } from "react";
import { Check, Sparkles, Megaphone } from "@/shared/ui/doodle-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { useEventFormContext } from "@/features/events/components/EventForm/EventForm/EventFormContext";
import { SCROLL_INTO_VIEW_DELAY_MS } from "@/shared/constants/ui";
import { toast } from "@/shared/hooks/use-toast";
import { Section } from "@/shared/layout";

interface EventSuccessScreenProps {
  onClose: () => void;
  onPromote?: () => void;
  isEditMode: boolean;
  isSubmissionOnly: boolean;
}

export function EventSuccessScreen({
  onClose,
  onPromote,
  isEditMode,
  isSubmissionOnly,
}: EventSuccessScreenProps) {
  const { t } = useTranslation();
  const { formData, selectedOrganizationName } = useEventFormContext();
  const successEvent = useMemo(
    () => ({
      occurrences: formData.occurrences.map((o) => ({
        dtstart_utc: o.dtstart_local,
        dtend_utc: o.dtend_local || null,
      })),
    }),
    [formData.occurrences],
  );

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
    <Section variant="surface" className="mx-auto w-full max-w-md">
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
            <p className="text-sm text-muted-foreground">
              {selectedOrganizationName}
            </p>
            <p className="text-sm text-muted-foreground">
              {formatCardDate(successEvent)}
              {" "}
              {t("common.at")}
              {" "}
              {formatCardTime(successEvent)}
            </p>
          </div>

          <div className="flex gap-2 w-full">
            <Button variant="secondary" onMouseDown={handleDone} className="flex-1">
              {t("common.done")}
            </Button>
            {onPromote && (
              <Button
                onMouseDown={onPromote}
                className="flex-1 bg-primary hover:bg-primary-hover"
              >
                <Megaphone className="size-4 mr-1.5" />
                {t("events.promote")}
              </Button>
            )}
          </div>
      </div>
    </Section>
  );
}
