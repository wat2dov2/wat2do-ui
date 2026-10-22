import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { OutreachCampaignCreate } from "@/features/admin/api/admin.api";
import { DialogBody, FormActions, Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { FormInput, FormSelect, FormTextarea } from "@/shared/ui/form-field";
import { LoadingButton } from "@/shared/ui/loading-button";
import outreach from "../../../../../../backend/controlbox/outreach.json" with { type: "json" };

const EMPTY: OutreachCampaignCreate = { name: "", lead_type: "hackathon", goal: "", school_slugs: [] };

interface NewCampaignDialogProps {
  isOpen: boolean;
  isSaving: boolean;
  onClose: () => void;
  onCreate: (campaign: OutreachCampaignCreate) => void;
}

/** Names a campaign and the kind of event the weekly research sweep looks for. */
export function NewCampaignDialog({ isOpen, isSaving, onClose, onCreate }: NewCampaignDialogProps) {
  const { t } = useTranslation();
  const [campaign, setCampaign] = useState(EMPTY);
  const close = () => {
    setCampaign(EMPTY);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && close()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t("admin.outreach.newCampaign")}</DialogTitle>
          <DialogDescription>{t("admin.outreach.newCampaignDescription")}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap={5}>
            <FormInput name="name" label={t("admin.outreach.campaignName")} required value={campaign.name}
              onChange={value => setCampaign(current => ({ ...current, name: String(value) }))} />
            <FormSelect name="lead_type" label={t("admin.outreach.leadType")} value={campaign.lead_type}
              onChange={value => setCampaign(current => ({ ...current, lead_type: value }))}
              options={Object.keys(outreach.lead_types).map(value => ({ value, label: t(`admin.outreach.leadTypes.${value}`) }))} />
            <FormTextarea name="goal" label={t("admin.outreach.goal")} rows={3} value={campaign.goal ?? ""}
              onChange={value => setCampaign(current => ({ ...current, goal: value }))} />
            <FormActions>
              <Button variant="outline" onClick={close} disabled={isSaving}>{t("common.cancel")}</Button>
              <LoadingButton isLoading={isSaving} loadingText={t("common.pleaseWait")} disabled={!campaign.name.trim()}
                onClick={() => onCreate(campaign)}>
                {t("admin.outreach.createCampaign")}
              </LoadingButton>
            </FormActions>
          </Stack>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
