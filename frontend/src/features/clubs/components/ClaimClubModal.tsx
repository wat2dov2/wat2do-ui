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

interface ClaimClubModalProps {
  isOpen: boolean;
  onClose: () => void;
  club: Club;
}

export function ClaimClubModal({ isOpen, onClose, club }: ClaimClubModalProps) {
  const { t } = useTranslation();
  const [role, setRole] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!role.trim()) {
      toast({
        title: t("common.error") || "Error",
        description: "Executive role is required.",
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
        title: "Claim Submitted Successfully",
        description: `Your claim to manage "${club.club_name}" has been submitted for verification.`,
        variant: "success",
      });
      onClose();
    } catch {
      toast({
        title: t("common.error") || "Error",
        description: "Failed to submit claim. You may have already submitted a claim for this club.",
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
          <DialogTitle>Claim Club Ownership</DialogTitle>
          <DialogDescription>
            Request to become the primary administrator and creator of <strong>{club.club_name}</strong>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <FieldGroup className="py-2">
            <Field>
              <FieldLabel htmlFor="exec-role">
                Your Executive Role <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                id="exec-role"
                type="text"
                placeholder="e.g. President, Vice President, Treasurer"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={isSubmitting}
                required
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="proof-url">
                Link to Verification Proof
              </FieldLabel>
              <Input
                id="proof-url"
                type="url"
                placeholder="e.g. Link to WUSA registration or official bio"
                value={proofUrl}
                onChange={(e) => setProofUrl(e.target.value)}
                disabled={isSubmitting}
              />
              <FieldDescription>
                Provide a link showing your name listed as an executive for this club.
              </FieldDescription>
            </Field>

            <DialogFooter className="pt-4 gap-2 flex justify-end">
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={isSubmitting}>
                  Cancel
                </Button>
              </DialogClose>
              <LoadingButton
                type="submit"
                isLoading={isSubmitting}
                loadingText="Submitting..."
              >
                Submit Claim
              </LoadingButton>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
