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
import { Input } from "@/shared/ui/input";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
} from "@/shared/ui/field";
import { toast } from "@/shared/hooks/use-toast";
import type { Club } from "@/shared/types";
import { api } from "@/shared/services/apiClient";

interface ClaimOrganizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  club: Club;
}

export function ClaimOrganizationModal({ isOpen, onClose, club }: ClaimOrganizationModalProps) {
  const { t } = useTranslation();
  const [role, setRole] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!role.trim()) {
      toast({
        title: t("common.error") || "Error",
        description: t("organizations.roleRequired"),
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post(`/clubs/${club.id}/claims`, {
        executive_role: role.trim(),
        proof_url: proofUrl.trim() || null,
      });

      toast({
        title: t("organizations.claimSubmitted"),
        description: t("organizations.claimSubmittedDesc", { name: club.club_name }),
        variant: "success",
      });
      onClose();
    } catch {
      toast({
        title: t("common.error") || "Error",
        description: t("organizations.claimFailed"),
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
          <DialogTitle>{t("organizations.claimOwnership")}</DialogTitle>
          <DialogDescription>
            {t("organizations.claimOwnershipDesc")} <strong>{club.club_name}</strong>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <FieldGroup className="py-2">
            <Field>
              <FieldLabel htmlFor="exec-role">
                {t("organizations.executiveRole")} <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                id="exec-role"
                type="text"
                placeholder={t("organizations.executiveRolePlaceholder")}
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={isSubmitting}
                required
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="proof-url">
                {t("organizations.proofLink")}
              </FieldLabel>
              <Input
                id="proof-url"
                type="url"
                placeholder={t("organizations.proofLinkPlaceholder")}
                value={proofUrl}
                onChange={(e) => setProofUrl(e.target.value)}
                disabled={isSubmitting}
              />
              <FieldDescription>
                {t("organizations.proofDescription")}
              </FieldDescription>
            </Field>

            <DialogFooter className="pt-4 gap-2 flex justify-end">
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={isSubmitting}>
                  {t("common.cancel")}
                </Button>
              </DialogClose>
              <LoadingButton
                type="submit"
                isLoading={isSubmitting}
                loadingText={t("common.submitting")}
              >
                {t("organizations.submitClaim")}
              </LoadingButton>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
