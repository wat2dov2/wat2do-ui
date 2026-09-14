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
import { MAX_IMAGE_UPLOAD_SIZE_BYTES } from "@/shared/constants/uploads";
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

    if (file.size > MAX_IMAGE_UPLOAD_SIZE_BYTES) {
      setUploadError(t("qrCode.imageSizeError"));
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
        title: t("common.error"),
        description: t("clubs.roleRequired"),
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
                label={t("clubs.proofImage")}
                imagePreview={imagePreview}
                onImageUpload={handleImageUpload}
                onRemoveImage={handleRemoveImage}
                fileInputRef={fileInputRef}
                error={uploadError}
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
