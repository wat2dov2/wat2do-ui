import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { OutreachLead } from "@/features/admin/api/admin.api";
import { FormalityBadge } from "@/features/admin/components/outreach/FormalityBadge";
import { gmailComposeUrl } from "@/features/admin/components/outreach/gmailCompose";
import { useCopyText } from "@/shared/hooks/useCopyText";
import { DialogBody, FormActions, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Check, Copy, ExternalLink, Mail } from "lucide-react";
import { FormTextarea } from "@/shared/ui/form-field";
import { ItemContent, ItemDescription, ItemTitle } from "@/shared/ui/item";
import { LoadingButton } from "@/shared/ui/loading-button";

interface LeadDetailsDialogProps {
  lead: OutreachLead | null;
  isSaving: boolean;
  onClose: () => void;
  onSaveNotes: (lead: OutreachLead, notes: string) => void;
}

/** One club's video script, the email sent with the video, and its claim link, ready to send. */
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
    { title: t("admin.outreach.script"), text: lead.script, copy: lead.script },
    {
      title: t("admin.outreach.email"),
      text: `${lead.email_subject}\n\n${lead.email_body}`,
      copy: lead.email_body,
    },
    { title: t("admin.outreach.claimLink"), text: lead.claim_url, copy: lead.claim_url },
  ];

  return (
    <>
      <DialogHeader>
        <DialogTitle>{lead.club_name}</DialogTitle>
        <DialogDescription>{[lead.school_name, lead.email].join(" · ")}</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <Stack gap={5}>
          <ItemContent>
            <ItemTitle>{t("admin.outreach.whyFit")}</ItemTitle>
            <ItemDescription length="full">{lead.pitch_reason}</ItemDescription>
          </ItemContent>
          <ItemContent>
            <ItemTitle>{t("admin.outreach.formality")}</ItemTitle>
            <FormalityBadge formality={lead.formality} />
            {lead.formality_signals.length > 0 && (
              <ItemDescription length="full">
                {lead.formality_signals.map(signal => t(`admin.outreach.formalitySignals.${signal}`)).join(" · ")}
              </ItemDescription>
            )}
          </ItemContent>
          {sections.map(section => (
            <ItemContent key={section.title}>
              <Stack direction="horizontal" justify="between" align="center" gap={2}>
                <ItemTitle>{section.title}</ItemTitle>
                <CopyButton text={section.copy} />
              </Stack>
              <ItemDescription length="full">{section.text}</ItemDescription>
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
              <Button asChild variant="ghost">
                <a href={lead.club_url} target="_blank" rel="noopener noreferrer"><ExternalLink />{t("admin.outreach.openClub")}</a>
              </Button>
              <Button asChild variant="ghost">
                <a href={lead.email_source_url} target="_blank" rel="noopener noreferrer"><ExternalLink />{t("admin.outreach.source")}</a>
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

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopyText();
  return (
    <Button type="button" variant="ghost" size="sm"
      onClick={() => void copy(text, { copied: t("admin.outreach.copied"), failed: t("admin.outreach.copyFailed") })}>
      {copied ? <Check /> : <Copy />}{t("admin.outreach.copy")}
    </Button>
  );
}
