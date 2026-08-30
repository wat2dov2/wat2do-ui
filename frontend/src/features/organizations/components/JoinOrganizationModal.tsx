import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { LoadingButton } from "@/shared/ui/loading-button";
import { Textarea } from "@/shared/ui/textarea";
import {
  Field,
  FieldLabel,
  FieldGroup,
} from "@/shared/ui/field";
import { toast } from "@/shared/hooks/use-toast";
import type { Organization } from "@/shared/types";
import { api } from "@/shared/services/apiClient";

interface JoinOrganizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  organization: Organization;
}

export function JoinOrganizationModal({ isOpen, onClose, organization }: JoinOrganizationModalProps) {
  const { t } = useTranslation();
  const [pitch, setPitch] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pitch.trim().length < 10) {
      toast({
        title: t("common.error") || "Error",
        description: "Please write a pitch of at least 10 characters.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post(`/organizations/${organization.id}/join-requests`, {
        pitch: pitch.trim(),
      });

      toast({
        title: "Application Sent",
        description: t("organizations.joinRequestSubmittedDesc", { name: organization.organization_name }),
        variant: "success",
      });
      onClose();
    } catch {
      toast({
        title: t("common.error") || "Error",
        description: "Failed to send application. You may have already applied to this club.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("organizations.joinTeam")}</DialogTitle>
          <DialogDescription>
            {t("organizations.joinTeamDesc")} <strong>{organization.organization_name}</strong>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <FieldGroup className="py-2">
            <Field>
              <FieldLabel htmlFor="join-pitch">
                {t("organizations.briefPitch")} <span className="text-destructive">*</span>
              </FieldLabel>
              <Textarea
                id="join-pitch"
                placeholder={t("organizations.briefPitchPlaceholder")}
                value={pitch}
                onChange={(e) => setPitch(e.target.value)}
                disabled={isSubmitting}
                className="min-h-28"
                maxLength={1000}
                required
              />
              <p className="text-xs text-muted-foreground text-right mt-1">
                {pitch.trim().length}{t("organizations.charsRemaining")}
              </p>
            </Field>

            <DialogFooter className="pt-4 gap-2 flex justify-end">
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={isSubmitting}>
                  {t("common.cancel")}
                </Button>
              </DialogClose>
              <LoadingButton
                type="submit"
                disabled={pitch.trim().length < 10}
                isLoading={isSubmitting}
                loadingText={t("common.submitting")}
              >
                {t("organizations.submitApplication")}
              </LoadingButton>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
