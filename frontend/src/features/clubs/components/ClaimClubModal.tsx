import { useState, useEffect } from "react";
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
import { ImageUploadField } from "@/shared/ui/image-upload-field";
import { uploadClaimProof } from "@/shared/services/uploadService";
import { toast } from "@/shared/hooks/use-toast";
import type { Club } from "@/shared/types";
import { api } from "@/shared/services/apiClient";
import { useRequireSignIn } from "@/features/auth/hooks/useSignInGate";
import { useClaimProof } from "@/features/clubs/hooks/useClaimProof";

interface ClaimClubModalProps {
  isOpen: boolean;
  onClose: () => void;
  club: Club;
}

export function ClaimClubModal({ isOpen, onClose, club }: ClaimClubModalProps) {
  const { t } = useTranslation();
  const [role, setRole] = useState("");
  const proof = useClaimProof();
  const { clear: clearProof } = proof;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const requireSignIn = useRequireSignIn();

  // Reset form when modal state changes
  useEffect(() => {
    if (isOpen) {
      setRole("");
      clearProof();
    }
  }, [isOpen, clearProof]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!role.trim()) {
      toast({
        title: t("common.error"),
        description: t("clubs.roleRequired"),
        variant: "destructive",
      });
      return;
    }
    // Anyone can fill in a claim; it is sent by a signed-in account.
    if (!(await requireSignIn())) return;

    setIsSubmitting(true);
    try {
      const uploadedUrl = proof.file ? await uploadClaimProof(proof.file) : null;

      await api.post(`/clubs/${club.id}/claims`, {
        executive_role: role.trim(),
        proof_url: uploadedUrl,
      });

      toast({
        title: t("clubs.claimSubmitted"),
        description: t("clubs.claimSubmittedDesc", { name: club.club_name }),
        variant: "success",
      });
      onClose();
    } catch (err) {
      console.error("Failed to submit claim:", err);
      toast({
        title: t("common.error"),
        description: t("clubs.claimFailed"),
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
          <DialogTitle>{t("clubs.claimOwnership")}</DialogTitle>
          <DialogDescription>
            {t("clubs.claimOwnershipDesc")} <strong>{club.club_name}</strong>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <FieldGroup className="py-2">
            <Field>
              <FieldLabel htmlFor="exec-role">
                {t("clubs.executiveRole")} <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                id="exec-role"
                type="text"
                placeholder={t("clubs.executiveRolePlaceholder")}
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={isSubmitting}
                required
              />
            </Field>

            <div className="space-y-1">
              <ImageUploadField
                label={t("clubs.proof")}
                accept={proof.accept}
                uploadPrompt={t("clubs.proofUploadPrompt")}
                imagePreview={proof.preview?.url}
                previewMedia={proof.preview?.media}
                onImageUpload={proof.select}
                onRemoveImage={proof.clear}
                fileInputRef={proof.fileInputRef}
                error={proof.error}
              />
              <FieldDescription>
                {t("clubs.proofDescription")}
              </FieldDescription>
            </div>

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
                {t("clubs.submitClaim")}
              </LoadingButton>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
