import { useState, useRef, useEffect } from "react";
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
import type { Organization } from "@/shared/types";
import { api } from "@/shared/services/apiClient";

interface ClaimOrganizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  organization: Organization;
}

export function ClaimOrganizationModal({ isOpen, onClose, organization }: ClaimOrganizationModalProps) {
  const { t } = useTranslation();
  const [role, setRole] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | undefined>(undefined);
  const [uploadError, setUploadError] = useState<string | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when modal state changes
  useEffect(() => {
    if (isOpen) {
      setRole("");
      setImageFile(null);
      setImagePreview(undefined);
      setUploadError(undefined);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [isOpen]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setUploadError("Please select a valid image file.");
      return;
    }

    const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      setUploadError("Image is too large. Max 5MB allowed.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setImageFile(file);
      setImagePreview(dataUrl);
      setUploadError(undefined);
    };
    reader.onerror = () => {
      setUploadError("Failed to read image file.");
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview(undefined);
    setUploadError(undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

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
      let uploadedUrl: string | null = null;
      if (imageFile) {
        uploadedUrl = await uploadClaimProof(imageFile);
      }

      await api.post(`/organizations/${organization.id}/claims`, {
        executive_role: role.trim(),
        proof_url: uploadedUrl,
      });

      toast({
        title: t("organizations.claimSubmitted"),
        description: t("organizations.claimSubmittedDesc", { name: organization.organization_name }),
        variant: "success",
      });
      onClose();
    } catch (err) {
      console.error("Failed to submit claim:", err);
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
            {t("organizations.claimOwnershipDesc")} <strong>{organization.organization_name}</strong>.
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

            <div className="space-y-1">
              <ImageUploadField
                label={t("organizations.proofImage")}
                imagePreview={imagePreview}
                onImageUpload={handleImageUpload}
                onRemoveImage={handleRemoveImage}
                fileInputRef={fileInputRef}
                error={uploadError}
              />
              <FieldDescription>
                {t("organizations.proofDescription")}
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
                {t("organizations.submitClaim")}
              </LoadingButton>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
