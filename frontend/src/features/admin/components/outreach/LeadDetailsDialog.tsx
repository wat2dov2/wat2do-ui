import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { OutreachLead } from "@/features/admin/api/admin.api";
import { gmailComposeUrl } from "@/features/admin/components/outreach/gmailCompose";
import { DialogBody, FormActions, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { ExternalLink, Mail } from "@/shared/ui/doodle-icons";
import { FormTextarea } from "@/shared/ui/form-field";
import { ItemContent, ItemDescription, ItemTitle } from "@/shared/ui/item";
import { LoadingButton } from "@/shared/ui/loading-button";

interface LeadDetailsDialogProps {
  lead: OutreachLead | null;
  isSaving: boolean;
  onClose: () => void;
  onSaveNotes: (lead: OutreachLead, notes: string) => void;
}

/** Everything the research agent wrote for one organizer, ready to record and send. */
export function LeadDetailsDialog({ lead, isSaving, onClose, onSaveNotes }: LeadDetailsDialogProps) {
  return (
    <Dialog open={lead !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent size="lg">
        {lead && <LeadDetails key={lead.id} lead={lead} isSaving={isSaving} onSaveNotes={onSaveNotes} />}
      </DialogContent>
    </Dialog>
  );
}

function LeadDetails({ lead, isSaving, onSaveNotes }: Omit<LeadDetailsDialogProps, "lead" | "onClose"> & { lead: OutreachLead }) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState(lead.notes);
  const sections = [
    { title: t("admin.outreach.context"), text: lead.context },
    { title: t("admin.outreach.videoScript"), text: lead.video_script },
    { title: t("admin.outreach.email"), text: `${lead.email_subject}\n\n${lead.email_body}` },
    { title: t("admin.outreach.followUp"), text: lead.follow_up },
  ];

  return (
    <>
      <DialogHeader>
        <DialogTitle>{lead.event_name}</DialogTitle>
        <DialogDescription>{[lead.organization, lead.contact_name, lead.email].filter(Boolean).join(" · ")}</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <Stack gap={5}>
          {sections.map(section => (
            <ItemContent key={section.title}>
              <ItemTitle>{section.title}</ItemTitle>
              <ItemDescription className="whitespace-pre-line">{section.text}</ItemDescription>
            </ItemContent>
          ))}
          <FormTextarea name="notes" label={t("admin.outreach.notes")} rows={3} value={notes} onChange={setNotes} />
          <FormActions align="between">
            <Stack direction="horizontal" gap={2} wrap>
              <Button asChild variant="outline">
                <a href={gmailComposeUrl({ to: lead.email, subject: lead.email_subject, body: lead.email_body })} target="_blank" rel="noopener noreferrer">
                  <Mail />{t("admin.outreach.openEmail")}
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href={gmailComposeUrl({ to: lead.email, subject: `Re: ${lead.email_subject}`, body: lead.follow_up })} target="_blank" rel="noopener noreferrer">
                  <Mail />{t("admin.outreach.openFollowUp")}
                </a>
              </Button>
              <Button asChild variant="ghost">
                <a href={lead.source_url} target="_blank" rel="noopener noreferrer"><ExternalLink />{t("admin.outreach.source")}</a>
              </Button>
            </Stack>
            <LoadingButton isLoading={isSaving} loadingText={t("common.pleaseWait")} disabled={notes === lead.notes}
              onClick={() => onSaveNotes(lead, notes)}>
              {t("admin.outreach.saveNotes")}
            </LoadingButton>
          </FormActions>
        </Stack>
      </DialogBody>
    </>
  );
}
